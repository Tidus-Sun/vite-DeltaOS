<div align='center' ><font size=6>vxWorks的ARMv7异常处理流程分析</font></div>

<div align="center">
    <img src="https://img.shields.io/badge/Write By-Tidus-blue">
    <img src="https://img.shields.io/badge/Version-1.0-red">
    <img src="https://img.shields.io/badge/Date-2021.01.13-ff69b4">
    <img src="https://img.shields.io/badge/Platform-ARMv7 vxWorks-orange">
</div>


-----

[TOC]

## 1.预备知识

### 1.1 中断异常向量表

当ARMv7处理器支持安全扩展（*Security Extensions*）和虚拟化扩展（*Virtualization Extensions*）时最多可有四张中断异常向量表，分别是：

* Non-secure vector table：位于Non-secure PL1&0地址空间，用于投递到Non-secure PL1的异常，Non-secure态下的*SCTLR.V*位决定向量表基址：
  * V == 0：Non-secure态的*VBAR*寄存器用于保存向量表基址
  * V == 1：向量表基址为0xFFFF0000
* Hyp vector table：位于Non-secure PL2地址空间，用于投递到Hyp模式的中断异常，*HVBAR*寄存器用于保存向量表基址
* Secure vector table：位于Secure PL1&0地址空间，用于投递到Secure PL1除Monitor模式外的所有中断异常，Secure态下的*SCTLR.V*位决定向量表基址：
  * V == 0：Secure态的*VBAR*寄存器用于保存向量表基址
  * V == 1：向量表基址为0xFFFF0000
* Monitor vector table：位于Secure PL1&0地址空间，用于投递到Monitor模式的中断异常，*MVBAR*寄存器用于保存向量表基址

各中断向量表入口的具体定义如下，注意向量表基址需以32字节对齐：

| 偏移 |        Secure         |      Non-secure       |                 Hyp                  |       Monitor       |
| :--: | :-------------------: | :-------------------: | :----------------------------------: | :-----------------: |
| 0x0  |         Reset         |       Not Used        |               Not used               |      Not used       |
| 0x4  | Undefined Instruction | Undefined Instruction | Undefined Instruction, from Hyp Mode |      Not used       |
| 0x8  |    Supervisor Call    |    Supervisor Call    |    Hypervisor Call, from Hyp Mode    | Secure Monitor Call |
| 0xC  |    Prefetch Abort     |    Prefetch Abort     |    Prefetch Abort, from Hyp Mode     |   Prefetch Abort    |
| 0x10 |      Data Abort       |      Data Abort       |      Data Abort, from Hyp Mode       |     Data Abort      |
| 0x14 |       Not Used        |       Not Used        |    HypTrap, or ==Hyp mode entry==    |      Not Used       |
| 0x18 |     IRQ interrupt     |     IRQ interrupt     |            IRQ interrupt             |    IRQ interrupt    |
| 0x1C |     FIQ interrupt     |     FIQ interrupt     |            FIQ interrupt             |    FIQ interrupt    |

上表中的*Hyp*列为投递到Hyp模式的中断异常向量入口，*Monitor*列为投递到Monitor模式的中断异常向量入口。

下表列出了Non-secure和Secure向量表中的中断异常发生时**默认**进入的处理器模式：

|       Exception       | PL1 Mode taken to |
| :-------------------: | :---------------: |
|         Reset         |    Supervisor     |
| Undefined Instruction |     Undefined     |
|    Supervisor Call    |    Supervisor     |
|    Prefetch Abort     |       Abort       |
|      Data Abort       |       Abort       |
|     IRQ interrupt     |        IRQ        |
|     FIQ interrupt     |        FIQ        |

虚拟化扩展引入了以下几种新的异常：

* Hypervisor Call：通过调用HVC指令触发，该指令在Non-secure User模式和Secure状态下不可用。在Non-secure PL1非Hyp模式执行时处理器切换到Hyp模式，并跳转到Hyp向量表的0x14处执行；如果在Hpy模式下调用则处理器跳转到0x8处执行
* Hyp Trap
* Virtual Abort：通过Non-secure向量表的Data Abort进入
* Virtual IRQ：通过Non-secure向量表的IRQ进入
* Virtual FIQ：通过Non-secure向量表的FIQ进入

以上三种虚拟中断异常在Non-secure向量表中没有独立的入口，其原理是将物理中断路由到处理器的Hyp模式，再根据需要决定是否以虚拟中断的形式投递到Non-secure PL1，处理器本身无法分辨中断异常是否是虚拟的。更多信息请查询ARMv7架构及GIC手册，此处不再赘述。

Hyp向量表的0x14是一下异常的入口：

* HypTrap
* Hypervisor Call：在Non-secure PL1非Hyp模式执行HVC指令
* HCR.TGE位为1时在Non-secure User模式发生以下异常：
  * Supervisor Call
  * Undefined Instruction
  * Prefetch Abort
  * Data Abort

### 1.2 中断异常返回地址

每种异常都有首选返回地址（*preferred return address*），具体定义如下：

|         Exception          |               Preferred return address               |        Taken to a mode at        |
| :------------------------: | :--------------------------------------------------: | :------------------------------: |
|   Undefined Instruction    |         Address of the UNDEFINED instruction         |            PL1,or PL2            |
|      Supervisor Call       | Address of the instruction after the SVC instruction |            PL1,or PL2            |
|    Secure Monitor Call     | Address of the instruction after the SMC instruction |   PL1,and only in Secure state   |
|      Hypervisor Call       | Address of the instruction after the HVC instruction |             PL2 only             |
|       Prefetch Abort       |         Address of aborted instruction fetch         |            PL1,or PL2            |
|         Data Abort         |   Address of instruction that generated the abort    |            PL1,or PL2            |
|       Virtual Abort        |        Address of next instruction to execute        | PL1,and only in Non-secure state |
|          Hyp Trap          |          Address of the trapped instruction          |             PL2 only             |
|         IRQ or FIQ         |        Address of next instruction to execute        |            PL1,or PL2            |
| Virtual IRQ or Virtual FIQ |        Address of next instruction to execute        | PL1,and only in Non-secure state |

当异常投递到PL1时，返回地址保存在LR_*\<mode\>*寄存器中，其值为首选返回地址==加==偏移量，具体如下：

|         Exception          | Offset |
| :------------------------: | :----: |
|   Undefined Instruction    |   +4   |
|      Supervisor Call       |  None  |
|    Secure Monitor Call     |  None  |
|       Prefetch Abort       |   +4   |
|         Data Abort         |   +8   |
|       Virtual Abort        |   +8   |
|         IRQ or FIQ         |   +4   |
| Virtual IRQ or Virtual FIQ |   +4   |

当异常投递到PL2时，返回地址保存在ELR_hyp寄存器中，其值与首选返回地址相同，没有偏移。

### 1.3 处理异常的处理器模式

软件可根据需要通过SCR、HCR寄存器的相关位改变异常发生后处理器进入的模式，详情请查询ARMv7架构手册的B1.8.4章节。

### 1.4 异常返回

异常返回需要同时将恢复值写入PC和CPSR寄存器，从PL1的模式返回时可使用以下指令：

* 带S位的数据处理指令（Data-processing instructions）且目标寄存器为PC，如*SUBS PC, LR, \#\<const\>*
  * \#\<const\>为0时*SUBS PC, LR*等同于*MOVS*指令
  * ARM建议异常返回不要使用除SUBS和MOVS外的数据处理指令
* 使用*RFE*指令
* 使用ARM指令集时可以使用*LDM*指令

从PL2模式返回时使用*ERET*指令，其他更多信息请查询ARMv7架构手册的B1.8.10章节。

### 1.5 常用指令

* *SRS*：保存异常上下文时可使用该指令将当前模式的*LR*和*SPSR*寄存器保存到指定处理器模式的栈空间中，详见手册B9.3.16章节。

  `SRS{<amode>}{<c>}{<q>} SP{!}, #<mode>`

* *CPS*：可使用该指令切换处理器模式以及开关中断，详见手册B9.3.2章节。

  `CPS<effect>{<q>} <iflags> {, #<mode>}`

* *LDREX*、*STREX*、*CLREX*：独占加载存储指令，配合使用可通过处理器的*local monitor*和*global monitor*机制保证在数据访问的原子性，详见手册A3.4章节。

* *RFE*

* *ERET*

## 2.初始化

vxWorks运行在处理器的Non-secure PL1&0状态，只需考虑一张中断异常向量表的实现。具体的中断异常初始化代码已经在《vxWorks的ARMv7中断初始化及处理流程分析》中进行了详细分析，请参考该文档，此处不再赘述。

## 3.Data Abort异常处理程序excEnterDataAbort

当发生Data Abort异常时，处理器会切换到Abort模式且关闭中断，将CPSR寄存器的值保存在SPSR，PC寄存器的值保存在LR_*abt*，然后跳转到中断异常向量表0x10偏移处执行。该地址是*LDR PC,  [PC, #0xF4]*指令的机器码*0xE59FF0F4*。该指令将excEnterDataAbort的地址加载到PC寄存器中，本节将分析excEnterDataAbort函数的相关处理。注：发生异常时处理的详细行为可参考手册B1.9.8章节伪代码的描述。

### 3.1 基本信息入栈，修改栈指针

通过前文可知，LR_*abt*寄存器为导致异常的指令地址+8，因此需要减8后与R0-R4一起入栈保存，注意这里使用的是*STMIB*指令入栈，即满增栈，==后续的*L$excEnterCommon*代码段会在此时栈最低地址空余出的4个字节中保存SPSR寄存器的值==。

```assembly
#if (_VX_CPU == _VX_ARMARCH7) 

/* 
 * Errata#775420: A data cache maintenance operation which aborts, 
 * followed by an ISB, without any DSB in-between, might lead to 
 * deadlock. A simple workaround for this erratum is to add a DSB 
 * at the beginning of the abort exception handler.
*/

DSB
#endif /* (_VX_CPU == _VX_ARMARCH7) */

/* adjust return address so it points to instruction that faulted */
SUB lr, lr, #8

/* save regs in save area */

#if !(ARM_THUMB2)
STMIB sp, {r0-r4, lr}
#else /*!(ARM_THUMB2)*/
...

#if ARM_HAS_LDREX_STREX

/* 
 * The state of the exclusive monitors is UNKNOWN after taking a Data Abort
 * exception, so prevent 'dangling' exclusive access locks.
*/

# if ((_VX_CPU != _VX_ARMARCH6) || (defined _WRS_CONFIG_SMP))

CLREX /* CLREX is only available for ARMv6K and above */

# else
...
```

在系统支持OSM处理时Abort模式异常栈增加了OSM Stack，OSM Stack用作满减栈，因此在保存过R0-R4和LR后将SP加96*4个字节，指向栈顶。

==所谓OSM处理，是系统初始化时通过excOsmInit()接口设置与页大小对齐的guard region（还需要调用taskStackGuardPageEnable()进行使能），当任务的异常栈发生上溢导致Data Abort时，异常处理程序会调用vmStateSet()接口将guard region大小的空间设置为可读写属性，从而扩大异常栈，避免上溢。==

```assembly
/*
 * offset stack pointer past ESF info area used by common exception
 * handler to area set aside to be used as OSM Stack...
 *
 *  -----------------------------------------------------------------------
 * | SPSR | r0 | r1 | r2 | r3 | r4 | lr | ...OSM stack area...  ...start * |
 *  -----------------------------------------------------------------------
 * ^                                 (<<<--OSM stack grows down... ) ^
 * | sp moves to point after ESF info area to start of OSM stack  ___|
 *
 * now remaining abort save area can be used as OSM stack...
 *
 *   OSM stack    |                 | <--- ESF info area
 *   used for     -------------------      for abort handling
 *   support in   |                 |
 *   calling      -------------------
 *   vmStateSet   |        |        |
 *                ----     /    -----
 *                ----     /    -----
 *             ^  ----     /    -----
 *             |  |        |        |
 *             |  -------------------
 *    Stack grows | OSM Stack Start | <--- TOS for OSM
 *      Down!!!   -------------------
 *                |                 |
 *
 * If underlying "C" code to implement vmStateSet changes
 * may need to increase stack size to match usage...
 */
ADD sp, sp, #96*4
```

Abort模式的栈定义如下：

```assembly
VAR_LABEL(abortSaveArea)
#if defined (_WRS_OSM_INIT)
VAR_LABEL(abortSaveArea_0)
.fill 96, 4 /* stack expanded for guard page support */
#else
VAR_LABEL(abortSaveArea_0) .fill 7, 4  /* 7 registers: SPSR,r0-r4,lr */
#endif  /* _WRS_OSM_INIT */
```

### 3.2 根据cpu_taskIdCurrent判断异常发生位置

通过宏_ARM_PER_CPU_VALUE_GET将vxKernelVars[*CORE_NUM*]的成员变量*cpu_taskIdCurrent*的值保存在R2寄存器中，*CORE_NUM*为当前处理器核心索引。

检查*cpu_taskIdCurrent*是否为NULL，如果为空说明异常出现在系统初始化阶段，跳转到move_back_to_stack处恢复原始栈基址后继续运行。

```assembly
_ARM_PER_CPU_VALUE_GET (r2, r3, taskIdCurrent) /* r2 -> TCB */
TEQ r2, #0
BEQ move_back_to_stack   /* if NULL, in pre-kernel */
```

### 3.3 判断是否设置栈保护

依次检查*osmGuardPageSize*，*vxIntStackOverflowSize*和*vxIntStackUnderflowSize*的值，不为0时说明设置了栈溢出保护（**任务异常栈或中断栈**），跳转到check_stack（[3.4章节](###3.4 检查栈空间)）处进行栈保护检查。如果未设置栈溢出保护则跳转到move_back_to_stack处执行常规处理。

```assembly
LDR r3, L$_osmGuardPageSize
LDR r3, [r3]       /* r3 -> osmGuardPageSize */
TEQ r3, #0         /* if NULL, osm guard regions not initialized */

BNE check_stack

#if defined(_ARCH_SUPPORTS_PROTECT_INTERRUPT_STACK)
/*
 * osm stack checking not initialized,
 * check if interrupt overflow guard page initialized
 * NOTE: interrupt stack protection assumed to be available only w/ MMU
 */

LDR r3, L$_vxIntStackOverflowSize
LDR r3, [r3]       /* r3 -> vxIntStackOverflowSize */
TEQ r3, #0         /* if NULL, interrupt overflow not initialized */
    
BNE check_stack

/*
 * interrupt overflow guard page not initialized,
 * check if interrupt underflow guard page intitialized
 */

LDR r3, L$_vxIntStackUnderflowSize
LDR r3, [r3]       /* r3 -> vxIntStackUnderflowSize */
TEQ r3, #0         /* if NULL, interrupt undeflow not initialized */
    
BNE check_stack
#endif  /* _ARCH_SUPPORTS_PROTECT_INTERRUPT_STACK */

B move_back_to_stack
```

*vxIntStackOverflowSize*和*vxIntStackUnderflowSize*在启动usrRoot任务时根据启动参数赋值：

```c
if (pParams->intStackOverflowSize > 0 || pParams->intStackUnderflowSize > 0)
{
    alignSize = pParams->vmPageSize;
    vxIntStackUnderflowSize = ROUND_UP(pParams->intStackUnderflowSize, alignSize);
    vxIntStackOverflowSize = ROUND_UP(pParams->intStackOverflowSize, alignSize);
    pParams->intStackSize = ROUND_UP(pParams->intStackSize, alignSize) + vxIntStackUnderflowSize
                            + vxIntStackOverflowSize;
}
```

### 3.4 针对栈空间的异常处理

#### 3.4.1 获取DFAR，判断处理器模式

读取*DFAR*寄存器到LR_*abt*中，该寄存器的值是导致Data Abort异常的地址。然后根据*SPSR.M[4:0]*判断异常发生时的处理器模式，如果不是SVC模式则不进行栈溢出检查，跳转到move_back_to_stack执行。

```assembly
check_stack:
    #ifndef _WRS_CONFIG_WRHV_COPROCESSOR_CTRL
    #ifndef ARMCPUMMULESS
    MRC CP_MMU, 0, r14, c6, c0, 0
    #endif /*ARMCPUMMULESS*/
    #endif /* _WRS_CONFIG_WRHV_COPROCESSOR_CTRL */

    /*
     * determine if stack overflow or underflow has occurred
     *
     * r14 <- fault address
     */

    /* get mode fault occurred in */
    MRS r3, spsr
    AND r3, r3, #MASK_SUBMODE           /* examine mode bits */
    TEQ r3, #MODE_SVC32 & MASK_SUBMODE  /* SVC? */

    /* User task, do not check for stack overflow. */

    BNE move_back_to_stack
```

#### 3.4.2 获取SVC模式栈指针

在关中断的状态下切换到SVC模式，将SVC模式的栈指针保存在R1寄存器中后再切换回Abort模式。==获取SP\_*svc*的目的是后续同时通过SP\_*svc*和DFAR判断是否发生栈溢出==。

```assembly
/* get SVC Mode stack pointer */
/* switch to SVC mode with interrupts (IRQs) disabled */

MRS r3, cpsr
BIC r1, r3, #MASK_MODE

#ifdef _WRS_CONFIG_UNIFIED_FIQ_IRQ

ORR r1, r1, #MODE_SVC32 | I_BIT | F_BIT

#else /*_WRS_CONFIG_UNIFIED_FIQ_IRQ*/

ORR r1, r1, #MODE_SVC32 | I_BIT

#endif /*_WRS_CONFIG_UNIFIED_FIQ_IRQ*/

MSR cpsr, r1

/*
 * save sp in non-banked reg so can access saved registers after
 * switching back to ABORT mode
 */

MOV r1, sp

/* switch back to ABORT mode (r3) */

MSR cpsr, r3
```

#### 3.4.3 判断异常发生位置

获取vxKernelVars[*CORE_NUM*].cpu_intCnt，如果该值不为0说明异常**发生在中断**中，跳转到check_interrupt_stack执行中断栈检查，为0说明异常**发生在任务**中。

```assembly
/* if intCnt == 0 we are from task */

_ARM_PER_CPU_VALUE_GET (r0, r3, intCnt)
TEQ r0, #0
#if !defined(_ARCH_SUPPORTS_PROTECT_INTERRUPT_STACK)
/* else just place ESF back on stack */
BNE move_back_to_stack    /* from interrupt, skip task stack check */
#else
/* else check interrupt stack */
BNE check_interrupt_stack /* from Interrupt, check int stack */
#endif  /* _ARCH_SUPPORTS_PROTECT_INTERRUPT_STACK */
```

#### 3.4.4 若异常发生在任务中

从*cpu_taskIdCurrent*（指针保存在R2中）中获取其成员变量options，判断任务创建时是否设置了VX_NO_STACK_PROTECT属性，如果设置了VX_NO_STACK_PROTECT则不进行栈溢出检查，跳转到move_back_to_stack处执行。

再获取*cpu_taskIdCurrent->excCnt*并判断是否为0，为0说明==没有异常嵌套，无需检查异常栈溢出==，跳转到move_back_to_stack中执行。

```assembly
LDR r0, [r2, #WIND_TCB_OPTIONS]     /* r0 -> options */
ANDS r0, r0, #VX_NO_STACK_PROTECT
BNE move_back_to_stack

/* go and check for event on exception stack */

LDRNE r0, [r2, #WIND_TCB_EXC_CNT]     /* get excCnt */
TEQ r0, #0
BEQ move_back_to_stack  /* Check stack overflow for exception */
```

##### 3.4.4.1 判断是否是栈溢出导致异常

获取*cpu_taskIdCurrent->pExcStackStart*（保存在R0），*cpu_taskIdCurrent->pExcStackEnd*（保存在R3）和*osmGuardPageSize*（保存在R2）。

若SP_*svc*（保存在R1中）大于等于*cpu_taskIdCurrent->pExcStackStart*，说明发生异常时栈指针不在异常栈范围内，异常与栈溢出无关（满减栈不会下溢，只会上溢），跳转到move_back_to_stack处执行。

若DFAR（保存在LR中）大于等于*cpu_taskIdCurrent->pExcStackStart*，说明本次异常不是访问异常栈导致的，跳转到move_back_to_stack处执行。

```assembly
LDR r0, [r2, #WIND_TCB_PEXC_STK_START]
LDR r3, [r2, #WIND_TCB_P_K_STK_END]
    
LDR r2, L$_osmGuardPageSize
LDR r2, [r2]            /* r2 -> osmGuardPageSize */
    
CMP r1, r0
BGE move_back_to_stack  /* exception stack do not have underflow
                           guard zone */
    
CMP r14, r0             /* check fault address, then */
    
BGT move_back_to_stack  /* exception stack do not have underflow
                           guard zone */
```

若SP_*svc*小于等于*cpu_taskIdCurrent->pExcStackEnd*，说明发生异常栈上溢，跳转到exc_stk_overrun处执行，[3.4.6章节](###3.4.6扩大栈空间)。

若DFAR大于*cpu_taskIdCurrent->pExcStackEnd*，说明访问异常栈时发生错误，但没有溢出，跳转到move_back_to_stack处执行。

```assembly
CMP r1, r3
BLE exc_stk_overrun     /* if >= end, then not in base-Guard */
    
CMP r14, r3             /* check fault address, then */
BGT move_back_to_stack  /* if >= end, then not in base-Guard */
```

将*cpu_taskIdCurrent->pExcStackEnd*减去*osmGuardPageSize*，再与*DFAR*比较，如果LR小于等于R3，说明*DFAR*在guard page范围之外，异常栈增加guard region也还是会发生溢出，跳转至move_back_to_stack执行。注意，若系统初始化时没有调用excOsmInit()设置*osmGuardPageSize*，该值默认为0。

```assembly
SUB r3, r3, r2          /* offset by guard page */
CMP r14, r3
ADDGT r3, r3, r2
BLE move_back_to_stack  /* if <= base-Guard, fault lies elsewhere */
```

如果SP_*svc*大于扩大后的异常栈栈顶（*cpu_taskIdCurrent->pExcStackEnd - osmGuardPageSize*），说明异常栈扩大后可以避免溢出，则跳转到enable_guard_region（[3.4.6 扩大栈空间](###3.4.6 扩大栈空间)）进行vmStateSet()操作，否则跳转move_back_to_stack。

```assembly
exc_stk_overrun:
    SUB r3, r3, r2          /* offset by guard page */
    CMP r1, r3

    /* actual OSM event, enable region, create ESF frame  */
    /* Note: vmStateSet needs lowest addr in guard region */
    MOV r0, r3
    BGT enable_guard_region

    B move_back_to_stack
```

#### 3.4.5 若异常发生在中断中

> 进入本分支说明异常发生在中断处理过程中，R1寄存器保存的是SP_*svc*的值，SP\_*svc*已经在中断处理程序intEnt中切换为系统中断栈*cpu_vxIntStackBase*。

获取vxKernelVars[*CORE_NUM*]的成员变量*cpu_vxIntStackBase*和*cpu_vxIntStackEnd*的值，分别保存在R0和R3寄存器中，即系统中断栈的栈底和栈顶。

```assembly
check_interrupt_stack:

	_ARM_PER_CPU_VALUE_GET (r0, r2, vxIntStackBase)
	_ARM_PER_CPU_VALUE_GET (r3, r2, vxIntStackEnd)
```

##### 3.4.5.1 是否发生中断栈下溢

获取*vxIntStackUnderflowSize*，保存在R2寄存器中。

* 如果SP_*svc*大于等于*cpu_vxIntStackBase*，说明发生了中断栈下溢，跳转到int_stk_underrun处执行。
* 如果DFAR小于*cpu_vxIntStackBase*，说明异常有可能是中断栈上溢导致的，跳转到check_int_end继续进行检查（[3.4.5.2 章节](##### 3.4.5.2 是否发生中断栈上溢)）。
* 如果DFAR大于*cpu_vxIntStackBase + vxIntStackUnderflowSize*，说明异常发生在其他位置，跳转到check_int_end（[3.4.5.2 章节](##### 3.4.5.2 是否发生中断栈上溢)）继续进行检查，否则说明异常发生在*vxIntStackUnderflowSize*的范围内，即中断栈下溢，进入int_stk_underrun处执行。

```assembly
LDR r2, L$_vxIntStackUnderflowSize
LDR r2, [r2]            /* r2 -> vxIntStackUnderflowSize */
	
CMP r1, r0
BGE int_stk_underrun    /* if < base, then not in base-Guard */
	
CMP r14, r0             /* check fault address, then */
BLT check_int_end       /* if < base, then not in base-Guard */
	
ADD r0, r0, r2          /* offset by guard page */
CMP r14, r0
SUBLE r0, r0, r2
BGT check_int_end       /* if > base-Guard, fault lies elsewhere */
```

##### 3.4.5.2 是否发生中断栈上溢

获取*vxIntStackOverflowSize*，保存在R2寄存器中。

* 如果SP\_*svc*小于等于*cpu_vxIntStackEnd*，说明发生中断栈上溢，跳转到int_stk_overrun处执行。
* 如果DFAR大于*cpu_vxIntStackEnd*，说明异常不是中断栈溢出导致的，跳转到move_back_to_stack处执行。
* 如果DFAR小于等于*cpu_vxIntStackEnd* - *vxIntStackOverflowSize*，说明异常发生在其他地址或扩大中断栈后依然上溢，因此跳转到move_back_to_stack处执行，否则说明异常发生在*vxIntStackOverflowSize*范围内，即中断栈上溢，进入int_stk_overrun处执行。

```assembly
check_int_end:
    LDR r2, L$_vxIntStackOverflowSize
    LDR r2, [r2]            /* r2 -> vxIntStackOverflowSize */
        
    CMP r1, r3
    BLE int_stk_overrun     /* if >= end, then not in base-Guard */
        
    CMP r14, r3             /* check fault address, then */
    BGT move_back_to_stack  /* if >= end, then not in base-Guard */
        
    SUB r3, r3, r2          /* offset by guard page */
    CMP r14, r3
    ADDGT r3, r3, r2
    BLE move_back_to_stack  /* if <= base-Guard, fault lies elsewhere */
```

##### 3.4.5.3 中断栈下溢处理

如果SP_svc小于*cpu_vxIntStackBase*（R0）+ *vxIntStackUnderflowSize*，说明中断栈向下扩大后可以避免溢出，跳转到enable_guard_region（[3.4.6 扩大栈空间](###3.4.6 扩大栈空间)）进行vmStateSet()操作，否则跳转move_back_to_stack。

```assembly
int_stk_underrun:
	ADD r0, r0, r2          /* offset by guard page */
	CMP r1, r0

	/* actual OSM event, enable region, create ESF frame  */
	/* Note: vmStateSet needs lowest addr in guard region */
	SUB r0, r0, r2
	BLT enable_guard_region

	/* else just place ESF back on stack */
	B move_back_to_stack
```

##### 3.4.5.4 中断栈上溢处理

如果SP_svc大于*cpu_vxIntStackEnd*（R3）+ *vxIntStackOverflowSize*（R2），说明中断栈向上扩大后可以避免溢出，跳转到enable_guard_region（[3.4.6 扩大栈空间](###3.4.6 扩大栈空间)）进行vmStateSet()操作，否则跳转move_back_to_stack。

```assembly
int_stk_overrun:
	SUB r3, r3, r2          /* offset by guard page */
	CMP r1, r3
	    
	/* actual OSM event, enable region, create ESF frame  */
	/* Note: vmStateSet needs lowest addr in guard region */
	MOV r0, r3
	BGT enable_guard_region
	    
	/* else just place ESF back on stack */
	B move_back_to_stack
```


#### 3.4.6 扩大栈空间（如果满足条件）

> 进入enable_guard_region说明可以通过扩大栈空间避免栈溢出导致的Data Abort

调用vmStateSet()设置guard region空间的属性为*VM_STATE_VALID | VM_STATE_WRITABLE*，即将栈扩大指定大小，避免溢出导致的Data Abort。R1为要设置的空间起始地址，R2为空间大小，R3为空间属性掩码，空间属性通过栈传递给excVmStateSet。

设置完成后进入常规异常处理，[3.5章节](###3.5 常规异常处理)。

```assembly
enable_guard_region:

    /* save regs on stack prior to calling out... */
    STMDB   sp!, {r0-r12,lr}

    /*
     * Call vmStateSet to make the guard region valid and writable.
     * If an exception stack is involved, it belongs to the current
     * task; for the interrupt stack it should not matter which
     * context is used since all include the kernel.
     *
     * vmStateSet (
     *      NULL,           /@ null context => current task    arg0 @/
     *      pBuf,           /@ lowest addr in guard region     arg1 @/
     *      bytes,          /@ sizeof(guard region)            arg2 @/
     *      VM_STATE_MASK_VALID | VM_STATE_MASK_WRITABLE,   /@ arg3 @/
     *      VM_STATE_VALID | VM_STATE_WRITABLE              /@ arg4 @/
     *      );
     *
     * Entries placed on OSM stack for re-enabling guard page...
     *  r0 - arg0, 0
     *  r1 - arg1, %esi ---base (underflow) or end (overflow)
     *  r2 - arg2, osmGuardPageSize
     *  r3 - arg3, VM_STATE_MASK_VALID | VM_STATE_MASK_WRITABLE
     *  sp - arg4, VM_STATE_VALID | VM_STATE_WRITABLE
     */

    * sp -> VM_STATE_VALID | VM_STATE_WRITABLE */
    MOV r3, #VM_STATE_VALID | VM_STATE_WRITABLE
    STMDB sp!, {r3} /* 寄存器只能传递4个参数，更多的参数需要通过栈传递 */
                   /* r3 -> VM_STATE_MASK_VALID | VM_STATE_MASK_WRITABLE */
    MOV r3, #VM_STATE_MASK_VALID | VM_STATE_MASK_WRITABLE
               /* r2 -> Guard Page Size */
    MOV r1, r0 /* r1 -> base (underflow) or end (overflow) */
    MOV r0, #0 /* r0 -> null context */
        
    BL excVmStateSet
    CMP r0, #OK
    BNE excOsmReBoot  /* should never happen, but... */

    LDMIA sp!, {r3}

    /* restore regs from stack prior to moving on... */
    LDMIA sp!, {r0-r12, lr}
```

### 3.5 修正栈指针

如果刚才进行了栈保护的检查，需要先将异常栈SP\_*abt*恢复到异常栈基址并从异常栈中LR_*abt*（导致异常的指令地址，即PC）。

设置R0的值为EXC_OFF_DATA，然后跳转到通用异常处理程序L$excEnterCommon处执行。

```assembly
move_back_to_stack:
	/*
	 * move OSM stack pointer to point back to ESF info area...
	 *
	 *  ---------------------------------------------------------------
	 * | SPSR | r0 | r1 | r2 | r3 | r4 | lr | ... start of OSM stack * |
	 *  ---------------------------------------------------------------
	 * ^                                                       ^
	 * | sp moved here to point to ESF info,  was pointng here |
	 *
	 * now ESF info stack area can be used in common exception handler...
	 *
	 */

	_ARM_PER_CPU_ADRS_GET_SPLR(sp, r0, abortSaveArea)

	#ifdef _WRS_CONFIG_SMP

	/*
	 * The saveArea entry in vxKernelVars is a pointer to the address
	 * so now we need to grab the actual address
	 */

	LDR sp, [sp]

	#endif /*_WRS_CONFIG_SMP*/

	LDR r14,[sp,#4*6]        /* restore LR to fault instruction */

	#endif  /* _WRS_OSM_INIT */

	/* set r0 -> exception vector and join main thread */

	MOV r0,#EXC_OFF_DATA
	B FUNC(L$excEnterCommon)
```

## 4 通用异常处理L$excEnterCommon

Data Abort异常，Undefined Instruction异常和Prefetch Abort异常完成预处理后都会进入L$excEnterCommon中执行。此时的处理器仍处在各异常模式中，异常栈及R0，LR寄存器的状态如下图所示：

```c
CPU Mode: 各异常模式
SP: SP_<mode>

 Low Address            Hight Address
 ------------------------------------
| SPSR | r0 | r1 | r2 | r3 | r4 | LR |
 ------------------------------------
    ^
    | 尚未填入
^   
| SP_<mode> 指向低地址，栈向高地址增长

Entry:
   R0 -> exception vector
   LR -> faulting instruction
```

### 4.1 保存SPSR，切换到SVC

获取SPSR，保存在异常栈中，并将SP_*abt*保存在R2寄存器中；然后切换到关中断状态下的SVC模式。

```assembly
/* save SPSR in save area */

MRS r3, spsr
STR r3, [sp]

/*
 * save sp in non-banked reg so can access saved registers after
 * switching to SVC mode
 */

MOV r2, sp

/* switch to SVC mode with interrupts (IRQs) disabled */

MRS r3, cpsr
BIC r1, r3, #MASK_MODE

#ifdef _WRS_CONFIG_UNIFIED_FIQ_IRQ

ORR r1, r1, #MODE_SVC32 | I_BIT | F_BIT

#else /*_WRS_CONFIG_UNIFIED_FIQ_IRQ*/

ORR r1, r1, #MODE_SVC32 | I_BIT

#endif /*_WRS_CONFIG_UNIFIED_FIQ_IRQ*/

MSR cpsr, r1
```

### 4.2 检查是否已经在使用任务异常栈

获取*cpu_taskIdCurrent*，如果*cpu_taskIdCurrent*为0说明异常出现在内核初始化阶段，直接使用当前栈进行异常处理，从SP_*abt*中恢复R4寄存器的值，再跳转至alreadyOnExcStack处执行。

检查*cpu_taskIdCurrent->excCnt*是否为0，不为0则用R1保存SP\_*svc*，从SP_*abt*中恢复R4寄存器的值，再跳转至alreadyOnExcStack（[4.4章节](###4.4 在任务异常栈构建上下文)）处执行。

```assembly
_ARM_PER_CPU_VALUE_GET (r1, r4, taskIdCurrent)  /* r1 -> TCB */
MOV r4, r1                          /* r4 -> TCB */
TEQ r1, #0
LDREQ r4, [r2,#4*5]                    /* restore r4 TODO:optimize */
BEQ alreadyOnExcStack               /* In pre-kernel stay on current stack */
LDR r1, [r1, #WIND_TCB_EXC_CNT]     /* get exception count */
TEQ r1, #0
MOVNE r1, sp                          /* r1 = svc_sp at exc time */
LDRNE r4, [r2,#4*5]                    /* restore r4 TODO:optimize */
BNE alreadyOnExcStack
```

### 4.3 切换至任务异常栈

从SP_*abt*中恢复R4寄存器的值（该操作的目的是后续构建异常上下文时要保存发生异常时R4寄存器的原始值），获取*cpu_taskIdCurrent->pExcStackBase*保存在R1中，将SVC模式的栈指针SP\_*svc*入任务异常栈保存，再将栈且换到任务异常栈，最后从任务异常栈中将SP\_*svc*出栈保存在R1寄存器中。

```assembly
/* switch to task's exception stack */
MOV r1, r4                          /* r1 -> TCB */
LDR r4, [r2,#4*5]                    /* restore r4 TODO:optimize */
LDR r1, [r1, #WIND_TCB_P_K_STK_BASE]    /* get stack pointer */
STMFD r1!, {sp}                       /* save svc_sp */
MOV sp, r1                          /* switch to exc stack */
LDMFD sp!, {r1}                       /* get back svc_sp */
```

### 4.4 在任务异常栈构建上下文

> CPU MODE: SVC32
> R0 -> Exception Vector
> R1 = SP_svc at time of exception
> R2 -> SP_abt
> R3 = CPSR of exception mode
> LR = LR_svc at time of exception
> SP_svc -> Task Exception Stack

* 将R0-R3，TTBR0寄存器入任务异常栈保存
* 从SP\_*abt*中获取LR\_*abt*和SPSR入任务异常栈保存
* SP\_*svc*减4 * 11字节，为保存R4-R11寄存器预留空间
* 通过SPSR判断异常发生时的处理器模式

```assembly
alreadyOnExcStack：
    STMFD sp!, {r0-r3}

    #ifndef _WRS_CONFIG_WRHV_COPROCESSOR_CTRL
    #ifndef ARMCPUMMULESS
    MRC CP_MMU, 0, r0, c2, c0, 0   /* get CP15_TTBASE to flush out */
    #endif /*ARMCPUMMULESS*/
    #endif /* _WRS_CONFIG_WRHV_COPROCESSOR_CTRL */

    /* Note: possible optimization. ttbase is meaningless if no MMU */
    STMFD sp!, {r0}                   /* reg set (ttbase) */

    /*
    * put registers of faulting task on stack in order defined
    * in REG_SET so can pass pointer to C handler
    */

    LDR r1, [r2, #4*6]        /* get LR of exception mode */
    LDR r3, [r2]             /* get SPSR of exception mode */
    STMFD sp!, {r1, r3}
    SUB sp, sp, #4*11         /* make room for r4..r14 */

    /*
    * check for USR mode exception - SYSTEM is handled as other modes
    * r3 = SPSR of exception mode
    */

    TST r3,#MASK_SUBMODE
```

#### 4.4.1 异常发生在User模式

如果异常发生在User模式，则通过`STM{<amode>}{<c>}{<q>} <Rn>, <registers>^`指令将User模式的R4-R14寄存器保存在任务异常栈，然后跳转到L$regsSaved处执行。注：\<registers\>后带^表示访问User模式的寄存器。

```assembly
STMEQIA sp, {r4-r14}^        /* EQ => USR mode */

BEQ L$regsSaved
```

#### 4.4.2 异常发生在非User模式

如果异常发生在非User模式，需要用R0暂存CPSR，R1暂存任务异常栈，然后在关中断的状态下切换到发生异常的处理器模式，将R4-R14寄存器保存到任务异常栈。这样做的目的是获取SP\_<*mode*>和LR\_<*mode*>。

```assembly
/*
* not USR mode so must change to USR mode to get sp,lr
* SYSTEM mode is also handled this way (but needn't be)
* r3 = PSR of faulting mode
*/

MOV r1, sp               /* r1 -> where to put regs */
MRS r0, cpsr             /* save current mode */

#ifdef _WRS_CONFIG_UNIFIED_FIQ_IRQ

ORR r3, r3, #(I_BIT | F_BIT)

#else

ORR r3, r3, #I_BIT

#endif /* _WRS_CONFIG_UNIFIED_FIQ_IRQ */

#if (!ARM_THUMB2)  /* Thumb-2 exceptions are handled in Thumb mode */
BIC r3, r3, #T_BIT
#endif /* (!ARM_THUMB2) */
MSR cpsr, r3

/* in faulting mode - interrupts still disabled */

STMIA r1, {r4-r14}         /* save regs */
```

==注意，此时需要检查异常是否发生在SVC模式中，如果是则刚刚在任务异常栈中保存的SP\_*svc*不正确（已经是任务异常栈指针，而不是发生异常时的原始值），需要从任务异常栈中获取[4.4章节](###4.4 在任务异常栈构建上下文)起始处保存的SP\_*svc*，再填回上下文中==。

最后通过恢复CPSR切换回SVC模式。

```assembly
/*
* check if it's SVC mode and, if so, overwrite stored sp.
* stack pointed to by r1 contains
*    r4..r14, PC, PSR of faulting mode
*    address of exception vector
*    svc_sp at time of exception
*    sp of exception mode
*    CPSR of exception mode
*/

AND r3, r3, #MASK_SUBMODE             /* examine mode bits */
TEQ r3, #MODE_SVC32 & MASK_SUBMODE   /* SVC? */
LDREQ r3, [r1, #4*15]                   /* yes, get org svc_sp */
STREQ r3, [r1, #4*9]                    /* and overwrite */

/* switch back to SVC mode with interrupts still disabled (r0) */

MSR cpsr, r0
```

从SP\_*abt*中恢复R0-R3寄存器的值（注意使用的是LDMIB指令，跳过了SP\_*abt*开头指向的SPSR），入任务异常栈保存。

```assembly
L$regsSaved:

    /* transfer r0-r3 to stack */

    LDMIB r2, {r0-r3}      /* get other regs */

    STMFD sp!, {r0-r3}
```

==至此，任务异常栈中的异常上下文已经构建完毕，内容如下图所示：==

```c
CPU mode: SVC, IRQ Disable
SP: SP_svc, Task Exception Stack, Full Descending

 Hight Address                                                                      Low Address
 ----------------------------------------------------------------------------------------------
| CPSR | SP_abt | SP_svc | Vector | TTBR0 | SPSR | PC | LR_<mode> | SP_<mode> | R12-R4 | R3-R0 |
 ----------------------------------------------------------------------------------------------
                                                      ^                                        ^
                                                ESF * |                       SP_svc/REG_SET * |
```

### 4.5 调用excExcContinue()

再次获取cpu_taskIdCurrent，如果cpu_taskIdCurrent不为空则将cpu_taskIdCurrent->excCnt加1并保存。

从任务异常栈中获取SPSR，将模式位修改为SVC后写入CPSR，==目的是恢复异常发生时的中断状态==。

```assembly
_ARM_PER_CPU_VALUE_GET (r0, r1, taskIdCurrent)  /* r0 -> TCB */
TEQ r0, #0                  /* Check if in pre-kernel */

LDRNE r1, [r0, #WIND_TCB_EXC_CNT]
ADDNE r1, r1, #1
STRNE r1, [r0, #WIND_TCB_EXC_CNT]

/* restore interrupt state of faulting code */

LDR r0, [sp, #4*16]           /* get PSR */
BIC r0, r0, #MASK_MODE        /* clear mode bits */
ORR r0, r0, #MODE_SVC32       /* select svc32 */
MSR cpsr, r0                 /* and write it to CPSR */
```

将SP\_*svc*赋值给R1，R0指向任务异常栈中的PC，调用C语言异常处理程序excExcContinue()。

```assembly
MOV r1, sp                   /* r1 -> REG_SET */
ADD r0, r1, #4*15             /* r0 -> ESF (PC, PSR, vector) */
LDR fp, [r1, #4*11]
BL FUNC(excExcContinue)    /* call C routine to continue */
```

## 5. excExcContinue()

excExcContinue()接口会根据异常类型调用C异常向量表excHandlerTbl[NUM_CHANGEABLE_EXC_VECS]中对应的C语言异常处理程序。系统默认的处理程序是excExcHandle()接口。

## 6. excExcHandle()

主要是ED&R等与系统相关操作，不在本文的范围之内。根据代码分析和实际调试，发生在任务中的异常并不会走后续的异常返回流程。

## 7. 异常返回

### 7.1 关中断

从excExcHandle()返回后首先关闭中断，防止异常返回过程被打断。

```assembly
/* exception handler returned (SVC32)-disable interrupts (IRQs) again */
MRS r0, cpsr

#ifdef _WRS_CONFIG_UNIFIED_FIQ_IRQ
ORR r0, r0, #(I_BIT | F_BIT)
#else
ORR r0, r0, #I_BIT
#endif /* _WRS_CONFIG_UNIFIED_FIQ_IRQ */

MSR cpsr, r0
```

### 7.2 转存R0-R3

从任务异常栈中获取SP\_*abt*，即处理器Abort模式的栈基址。将任务异常栈中的R0-R3出栈，转存至Abort模式的栈空间中。

```assembly
LDR r2, [sp, #4*20]           /* r2 -> exception save area */
LDMFD sp!, {r3-r6}             /* get r0-r3 */
STMIB r2, {r3-r6}
```

### 7.3 异常发生在User模式

从任务异常栈中获取SPSR，判断异常发生时的处理器模式。如果是User模式，则从任务异常栈中将R4-LR寄存器出栈恢复，并跳转到L$regsRestored处执行。

```assembly
LDR r3, [sp, #4*12]           /* get PSR of faulting mode */
TST r3,#MASK_SUBMODE

LDMEQIA sp, {r4-r14}^            /* EQ => USR mode */

BEQ L$regsRestored
```

### 7.4 异常发生在非User模式

异常发生在非User模式时，用R0保存当前的处理器状态（CPSR），用R1保存当前栈指针（SP\_*svc*），将SPSR写入CPSR以切换到发生异常时的处理器模式（关中断），再将R4-LR寄存器出栈恢复。切换处理器模式的目的是为了能正确恢复SP\_<*mode*>和LR\_<*mode*>寄存器。

检查当前是否是SVC模式，如果是则SP\_*svc*已经被恢复成发生异常时的值，此处需要切换回任务异常栈。

最后恢复之前R0中保存的CPSR，返回SVC模式。

```assembly
/* exception was not in USR mode so switch to mode to restore regs */

MRS r0, cpsr                /* save PSR (SVC32, IRQs disabled) */

/*
 * r0 = PSR we can use to return to this mode
 * r3 = PSR of faulting mode
 */

MOV r1, sp                   /* r1 -> from where to load regs */

#ifdef _WRS_CONFIG_UNIFIED_FIQ_IRQ

ORR r3, r3, #(I_BIT | F_BIT)

#else

ORR r3, r3, #I_BIT

#endif /* _WRS_CONFIG_UNIFIED_FIQ_IRQ */

#if (!ARM_THUMB2)  /* exceptions are handled in Thumb-mode for Thumb-2 */
BIC r3, r3, #T_BIT
#endif /* (!ARM_THUMB2) */

MSR cpsr, r3

/*
 * in faulting mode - interrupts still disabled
 * r1 -> svc stack where r4-r14 are stored
 */

LDMIA r1, {r4-r14}             /* load regs */

/*
 * If it's SVC mode, reset sp as we've just overwritten it
 * The correct value is in r1
 */

AND r3, r3, #MASK_SUBMODE             /* examine mode bits */
TEQ r3, #MODE_SVC32 & MASK_SUBMODE   /* SVC? */
MOVEQ sp, r1

/* switch back to SVC mode with interrupts still disabled (r0) */

MSR cpsr, r0
```

### 7.5 转存PC和SPSR

> 运行至此，除SP\_*svc*外R4-LR寄存器都已恢复到发生异常时的状态。

R4-LR都已经恢复到寄存器，因此将SP\_*svc*加4*11以修正到正确位置，此时任务异常栈状态如下图所示。

```c
CPU mode: SVC, IRQ Disable
SP: SP_svc, Task Exception Stack, Full Descending

 Hight Address                             Low Address
 -----------------------------------------------------
| CPSR | SP_abt | SP_svc | Vector | TTBR0 | SPSR | PC |
 ------------------------------------------------------
                                                      ^
                                               SP_svc |
```

将任务异常栈中的PC和SPSR出栈保存在R1和R3寄存器中，再转存到Abort模式的栈空间中。

将TTBR0出栈，该值已经无用。

```assembly
/* r4..r14 of faulting mode now restored */
ADD sp, sp, #4*11         /* strip r4..r14 from stack */

LDMFD sp!, {r1, r3}         /* get LR and SPSR of exception mode */
STR r1, [r2, #4*5]        /* save LR in exception save area */
STR r3, [r2]             /* ..with SPSR */

/* get the remaining stuff off the stack */

LDMFD sp!, {r1}     /* unload ttbase */
```

至此，Abort模式栈的内容如下图所示：

```c
CPU Mode: Abort
SP: SP_abt

 Low Address       Hight Address
 -------------------------------
| SPSR | r0 | r1 | r2 | r3 | PC |
 -------------------------------
^
| SP_abt/R2
```

### 7.6 恢复状态并返回

获取*cpu_taskIdCurrent->excCnt*，如果*cpu_taskIdCurrent*不为空则将*cpu_taskIdCurrent->excCnt*减1并保存。

```assembly
/* decrement excCnt prior to shifting back */
_ARM_PER_CPU_VALUE_GET (r0, r1, taskIdCurrent)  /* r0 -> TCB */
TEQ r0, #0                  /* Check if in pre-kernel */

LDRNE r1, [r0, #WIND_TCB_EXC_CNT]      /* get excCnt */
SUBNE r1, r1, #1                       /* decrement excCnt */
STRNE r1, [r0, #WIND_TCB_EXC_CNT]      /* and store in TCB */
```

* 将任务异常栈中的剩余内容出栈，保存到R0-R3寄存器，任务异常栈指针恢复到处理本次异常前的位置
* 恢复发生异常时的SVC模式的栈SP\_*svc*
* 切换到Abort模式（==R3中的CPSR是进入异常模式后的CPSR，对于Data Abort是Abort模式，对于Undefined Instrution就是Undefined模式==）
* 从Abort模式栈中获取SPSR的值，恢复到SPSR寄存器
* 最终从Abort模式栈中恢复R0-R3寄存器，并将返回地址写入PC，完成异常处理返回。
  * 注意此处使用的是*LDMIB*寄存器，出栈时跳过了Abort模式栈最开始保存的SPSR
  * *LDM*指令的寄存器列表中有PC寄存器时，^符号表示同时将SPSR寄存器的值写入CPSR寄存器中
  * SP\_*abt*在整个异常处理过程中都未发生变化

```assembly
/*
 * r0 = address of exception vector - discarded
 * r1 = svc_sp at time of exception - discarded
 * r2 = sp of exception mode
 * r3 = CPSR of exception mode
 */

LDMFD sp!, {r0-r3}

MOV sp, r1            /* restore original svc_sp */

MSR cpsr, r3           /* switch back to exception mode */

LDMIB r2, {r0-r3, pc}^
```





-----


> 注1：==cpu_taskIdCurrent->pExcStackStart是真正的异常栈基址==，任务创建时会因为各种情况调用taskStackAllot接口从任务异常栈基址上预留指定空间，并用cpu_taskIdCurrent->pExcStackBase记录修改后异常栈基址。

> 注2：vxWorks创建任务时运行栈和异常栈空间时连续的，异常栈在更高的地址。异常栈栈顶（pExcStackEnd）比运行栈基址高16字节。（尚未对任务创建代码进行详细分析，目前结论通过系统运行时查看任务信息得到）

```c
 /* 任务的运行栈与异常栈示意图 */
 Low Address             <<<-- Stack grows down...         Hight Address
 -----------------------------------------------------------------------
|    Task Execution Stack      | 16Bytes |     Task Exception Stack     |
 -----------------------------------------------------------------------
                               ^                                 ^
^                   pStackBase |         ^         pExcStackBase |      ^
| pStackEnd                 pExcStackEnd |               pExcStackStart |
```
