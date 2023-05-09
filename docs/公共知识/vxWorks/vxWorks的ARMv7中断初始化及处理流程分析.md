<div align='center' ><font size=6>vxWorks的ARMv7中断初始化及处理流程分析</font></div>

<br>

<div align="center">
    <img src="https://img.shields.io/badge/Platform-ARMv7 vxWorks-orange" style="display: inline-block;">&nbsp;
    <img src="https://img.shields.io/badge/Version-1.0-red" style="display: inline-block;">&nbsp;
    <img src="https://img.shields.io/badge/Date-2020.06.08-ff69b4" style="display: inline-block;">&nbsp;
    <img src="https://img.shields.io/badge/Write By-Tidus-blue" style="display: inline-block;">
    
</div>

---

[[TOC]]

## 1.预备知识

以飞腾处理器为例，FT1500 是 ARMv8 架构，但在 vxWorks 中切换到 Non-Secoure AArch32 模式运行，因此其中断异常模型与 ARMv7 架构相同。ARMv7 的中断向量表定义如下（该表省略了 Hyp 和 Monitor 模式）：

| 偏移 |        Secure         |      Non-secure       |
| :--: | :-------------------: | :-------------------: |
| 0x0  |         Reset         |       Not Used        |
| 0x4  | Undefined Instruction | Undefined Instruction |
| 0x8  |    Supervisor Call    |    Supervisor Call    |
| 0xC  |    Prefetch Abort     |    Prefetch Abort     |
| 0x10 |      Data Abort       |      Data Abort       |
| 0x14 |       Not Used        |       Not Used        |
| 0x18 |          IRQ          |          IRQ          |
| 0x1C |          FIQ          |          FIQ          |

ARMv7 最多可有四张中断异常向量表，分别在 Non-secure PL1&0、Non-secure PL2、Secure PL1 和 Secure Monitor。vxWorks 运行在 Non-secure PL1&0，因此只需考虑一张中断异常向量表的实现。

在 Non-secure 中，SCTLR 寄存器的 V 位决定了向量表的地址，为 0 时向量表基址保存在 VBAR 寄存器中，为 1 时在 0xFFFF0000 处，注意向量表需以 32 字节对齐。

操作系统内核在处理器 PL1 等级的 SVC 模式下运行，RTP 在 PL0 等级的 User 模式下运行，当处理器接收到中断或产生异常时，会自动跳转到中断异常向量表的对应入口，切换到相应的处理器模式并关闭中断。

ARMv7 的寄存器集如下表格所示：

|  User   | System |   Hyp    | Supervisor |  Abort   | Undefined | Monitor  |   IRQ    |   FIQ    |
| :-----: | :----: | :------: | :--------: | :------: | :-------: | :------: | :------: | :------: |
|   R0    |        |          |            |          |           |          |          |          |
|   R1    |        |          |            |          |           |          |          |          |
|   R2    |        |          |            |          |           |          |          |          |
|   R3    |        |          |            |          |           |          |          |          |
|   R4    |        |          |            |          |           |          |          |          |
|   R5    |        |          |            |          |           |          |          |          |
|   R6    |        |          |            |          |           |          |          |          |
|   R7    |        |          |            |          |           |          |          |          |
|   R8    |        |          |            |          |           |          |          |  R8_fiq  |
|   R9    |        |          |            |          |           |          |          |  R9_fiq  |
|   R10   |        |          |            |          |           |          |          | R10_fiq  |
| R11(FP) |        |          |            |          |           |          |          | R11_fiq  |
| R12(IP) |        |          |            |          |           |          |          | R12_fiq  |
| R13(SP) |        |  SP_hyp  |   SP_svc   |  SP_abt  |  SP_und   |  SP_mon  |  SP_irq  |  SP_fiq  |
| R14(LR) |        |          |   LR_svc   |  LR_abt  |  LR_und   |  LR_mon  |  LR_irq  |  LR_fiq  |
| R15(PC) |        |          |            |          |           |          |          |          |
|  CPSR   |        |          |            |          |           |          |          |          |
|         |        | SPSR_hyp |  SPSR_svc  | SPSR_abt | SPSR_und  | SPSR_mon | SPSR_irq | SPSR_fiq |
|         |        | ELR_hyp  |            |          |           |          |          |          |

根据 ARM 官方文档《Procedure Call Standard for the ARM® Architecture》可知：

- R0-R3 用于在调用子程序时传递参数
- R4-R11 用于保存局部变量，子程序用到这些寄存器时必须入栈保存，返回时出栈恢复
- R12 用于子程序间的 Scratch 寄存器，记作 IP
- R13 用于栈指针，记作 SP
- R14 用于保存子程序返回地址，记作 LR
- R15 用于程序计数器，记作 PC

==这意味着编译器编译 C 函数时会将 R4-R11 寄存器按需入栈保存，编写汇编程序调用 C 函数时需要手动将 R0-R3，IP，LR 入栈保存。==入栈顺序为编号大的寄存器在栈的高地址，编号小的寄存器在低地址，出栈时编号小的寄存器先出栈。

## 2.初始化

### 2.1 excVecBaseSet

excVecBaseSet 的调用路线为 sysStart()->SYS_HW_INIT_0()[^1]->excVecBaseSet()。sysHwInit0 在 sysLib.c 文件中实现，传递的参数*base*为宏 LOCAL_MEM_LOCAL_ADRS，即 RAM 的起始地址，FT1500A 中为 0x80000000。

该接口会将 LOCAL_MEM_LOCAL_ADRS 作为异常向量表基址保存在全局变量 excVecBaseAddr 中，以便后续写入 VBAR 寄存器。

全局结构体变量==excEnterTbl==用于保存异常向量表中各向量的入口地址及对应的处理函数，该变量的默认定义如下：

```c
LOCAL EXC_TBL excEnterTbl[NUM_EXC_VECS] =
{
	/* no entry for branch through zero */
	{ EXC_OFF_UNDEF, excEnterUndef},		/* undefined instr */
    { EXC_OFF_SWI, excEnterSwi},           /* software interrupt */
	{ EXC_OFF_PREFETCH, excEnterPrefetchAbort},	/* prefetch abort */
	{ EXC_OFF_DATA, excEnterDataAbort},	/* data abort */
	/* no entry for old address exception */
#ifdef _WRS_CONFIG_UNIFIED_FIQ_IRQ
    /*
    * no entry for IRQ;
    * MSR instruction will be inserted instead in excVecInit() to allow
    * execution to continue to common handler at FIQ entry
    */
	{ EXC_OFF_FIQ, intEnt},		/* fast int. request */
#else
	{ EXC_OFF_IRQ, intEnt},		/* interrupt request */
	/* no entry for FIQ */
#endif /* _WRS_CONFIG_UNIFIED_FIQ_IRQ */
};
```

excVecBaseSet()会根据向量表基址更新各向量的实际入口地址。

```c
void excVecBaseSet (UINT32 base)
{
#if (CPU == ARMARCH7)
    /* set the exception vector base address */
    excVecBaseAddr = base;
#endif /* CPU == ARMARCH7 */

    excEnterTbl[0].vecAddr = EXC_OFF_UNDEF    + base;
    excEnterTbl[1].vecAddr = EXC_OFF_SWI      + base;
    excEnterTbl[2].vecAddr = EXC_OFF_PREFETCH + base;
    excEnterTbl[3].vecAddr = EXC_OFF_DATA     + base;

#ifdef _WRS_CONFIG_UNIFIED_FIQ_IRQ
    excEnterTbl[4].vecAddr = EXC_OFF_FIQ      + base;
#else
    excEnterTbl[4].vecAddr = EXC_OFF_IRQ      + base;
#endif /* _WRS_CONFIG_UNIFIED_FIQ_IRQ */
}
```

### 2.2 excVecInit

中断异常初始化的大部分工作都在 excVecInit 中完成，主要分为以下几个操作：

#### 2.2.1 设置向量基址寄存器 VBAR

调用 excVBARSet 向 VBAR 寄存器写入异常向量表基址，向量表基址必须以 32 字节对齐，因此通过 BIC 指令将基址低 5 位清 0。

```c
FUNC_BEGIN(excVBARSet)
	BIC	r1, r0, #0x1F		/* r1 = masked address  */
	MCR p15, 0, r1, c12, c0, 0  /* VBAR = r1 */
	BX 	lr
FUNC_END(excVBARSet)
```

#### 2.2.2 调用 armInitExceptionModes

armInitExceptionModes 在 coreExcALib.s 文件中实现，该段汇编会获取 Undefined，Abort，Swi(SVC)和 IRQ 模式预留的栈空间基址，保存在全局变量 deltaKernelVars[VX_MAX_SMP_CPUS]对应的成员中。

```c
#if defined(_WRS_CONFIG_MULTI_CLUSTERS) && defined(_WRS_CONFIG_SMP)
 	stmfd	sp!, {r4 - r7}
#endif /* _WRS_CONFIG_MULTI_CLUSTERS && _WRS_CONFIG_SMP */

#ifdef _WRS_CONFIG_SMP

	_ARM_PER_CPU_SAVE_AREA_ADR_GET(r0, r1, undefSaveArea) /*执行完该宏后r0为栈基址，r1为处理器核索引号*/
	_ARM_PER_CPU_ADRS_GET(r1, r2, undefSaveArea) /*执行完该宏后r1为处理器核对应的全局变量成员地址，该成员保存栈基址*/
	str r0, [r1]    /* store local address into vxKernelVars */

	_ARM_PER_CPU_SAVE_AREA_ADR_GET(r0, r1, abortSaveArea)
	_ARM_PER_CPU_ADRS_GET(r1, r2, abortSaveArea)
	str r0, [r1]    /* store local address into vxKernelVars */

	_ARM_PER_CPU_SAVE_AREA_ADR_GET(r0, r1, swiSaveArea)
	_ARM_PER_CPU_ADRS_GET(r1, r2, swiSaveArea)
	str r0, [r1]    /* store local address into vxKernelVars */

	_ARM_PER_CPU_SAVE_AREA_ADR_GET(r0, r1, irqStack)
	_ARM_PER_CPU_ADRS_GET(r1, r2, irqStack)
	str r0, [r1]    /* store local address into vxKernelVars */

#endif /*_WRS_CONFIG_SMP*/
```

##### 2.2.2.1 宏\_ARM_PER_CPU_SAVE_AREA_ADR_GET

宏\_ARM_PER_CPU_SAVE_AREA_ADR_GET 的目的是根据处理器核索引号获取其对应的处理器异常模式所使用的栈空间。

```c
#define _ARM_PER_CPU_SAVE_AREA_ADR_GET(r, scratch, label)    \
    _ARM_CPU_INDEX_GET(scratch)                         ; \
    LDR   r, _ARM_PER_CPU_CONCAT_CPU(label,0) /* default area zero*/ ; \
    CMP   scratch, IMM1                                 ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,1)           ; \
    CMP   scratch, IMM2                                 ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,2)           ; \
    CMP   scratch, IMM3                                 ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,3)           ; \
    CMP   scratch, IMM4                                 ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,4)           ; \
    CMP   scratch, IMM5                                 ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,5)           ; \
    CMP   scratch, IMM6                                 ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,6)           ; \
    CMP   scratch, IMM7                                 ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,7)           ; \
    CMP   scratch, IMM8                                 ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,8)           ; \
    CMP   scratch, IMM9                                 ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,9)           ; \
    CMP   scratch, IMM10                                ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,10)          ; \
    CMP   scratch, IMM11                                ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,11)          ; \
    CMP   scratch, IMM12                                ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,12)          ; \
    CMP   scratch, IMM13                                ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,13)          ; \
    CMP   scratch, IMM14                                ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,14)          ; \
    CMP   scratch, IMM15                                ; \
    LDREQ r, _ARM_PER_CPU_CONCAT_CPU(label,15)
```

###### 2.2.2.1.1 获取处理器核的索引号

先通过宏\_ARM_CPU_INDEX_GET 获取处理器核的索引号，注意 vxWorks 原始代码只获取 MPIDR 寄存器的低 4 位，而 16 核 FT1500 的 ID 由 Aff1 和 Aff0 组成，因此需要对该宏进行改写：

```c
#define _ARM_CPU_INDEX_GET(r)              \
    stmfd sp!, {r2};\
    MRC p15, 0, r2, c0, c0, 5;\ /*读取MPIDR寄存器*/
    MOV r, r2, LSR#8;\
    AND r, r, #0xFF;\           /*右移8位获取Aff1*/
    MOV r, r, LSL#2;\           /*再左移两位，相当于Aff1 * 2*/
    AND r2, r2, #0xFF;\         /*获取Aff0*/
    ADD r, r, r2;\              /*Aff1 * 2 + Aff0 即可得到处理器的索引号*/
    ldmfd sp!, {r2}
```

###### 2.2.2.1.2 获取预留的栈基址（0 号核）

通过宏\_ARM_PER_CPU_CONCAT_CPU 将异常名称和处理器核组成一个“标签”，该标签通过.long 伪汇编存储了对应异常模式栈基址。

```c
#define _ARM_PER_CPU_CONCAT_CPU(label, cpu) L$_##label##_##cpu
```

每个核都有 4 个异常模式栈，vxWorks 默认只定义了 4 个核的异常模式栈，如果要支持大于 4 个核的处理器，要增加其他核异常栈的定义。

```c
L$_undefSaveArea_0:   .long   VAR(undefSaveArea_0)
L$_abortSaveArea_0:   .long   VAR(abortSaveArea_0)
L$_swiSaveArea_0:     .long   VAR(swiSaveArea_0)
L$_irqStack_0:        .long   VAR(irqStack_0)

L$_undefSaveArea_1:   .long   VAR(undefSaveArea_1)
L$_abortSaveArea_1:   .long   VAR(abortSaveArea_1)
L$_swiSaveArea_1:     .long   VAR(swiSaveArea_1)
L$_irqStack_1:        .long   VAR(irqStack_1)

L$_undefSaveArea_2:   .long   VAR(undefSaveArea_2)
L$_abortSaveArea_2:   .long   VAR(abortSaveArea_2)
L$_swiSaveArea_2:     .long   VAR(swiSaveArea_2)
L$_irqStack_2:        .long   VAR(irqStack_2)

L$_undefSaveArea_3:   .long   VAR(undefSaveArea_3)
L$_abortSaveArea_3:   .long   VAR(abortSaveArea_3)
L$_swiSaveArea_3:     .long   VAR(swiSaveArea_3)
L$_irqStack_3:        .long   VAR(irqStack_3)
```

###### 2.2.2.1.3 根据核索引号获取对应的栈空间

==除 0 号核外的其他核运行时，会根据获取的核索引号获取对应的栈基址。==至此宏\_ARM_PER_CPU_SAVE_AREA_ADR_GET 运行完成，R0 的值为栈基址，R1 得值为处理器核索引号。

下面以 0 号核的 Undefined 异常为例说明宏\_ARM_PER_CPU_SAVE_AREA_ADR_GET 的功能，宏依次展开可得：

```c
_ARM_PER_CPU_SAVE_AREA_ADR_GET(r0, r1, undefSaveArea)
LDR r0, _ARM_PER_CPU_CONCAT_CPU(undefSaveArea,0)
LDR r0, L$_undefSaveArea_0
```

L$\_undefSaveArea_0 等标签同样定义在 coreExcALib.s 中（宏 VAR 无实际意义）

```c
L$_undefSaveArea_0:   .long   VAR(undefSaveArea_0)
```

undefSaveArea_0 标记了处理器进入 Undefined 模式后使用的栈基址，其使用伪汇编.fill 预留了*7 + EXTRA_STACK*个 4 字节的空间。

```c
VAR_LABEL(undefSaveArea)
VAR_LABEL(undefSaveArea_0) .fill 7 + EXTRA_STACK, 4  /* 7 registers: SPSR,r0-r4,lr */
```

`LDR r0, L$_undefSaveArea_0`指令将 undefSaveArea_0 所标记的地址保存在 r0 寄存器中。

==注意，在系统支持 OSM 处理时 Abort 模式异常栈增加了 OSM Stack，与其他异常模式不同。==

```c
VAR_LABEL(abortSaveArea)
#if defined (_WRS_OSM_INIT)
VAR_LABEL(abortSaveArea_0)
.balign 8
.fill 96 + EXTRA_STACK, 4 /* stack expanded for guard page support */
#else
VAR_LABEL(abortSaveArea_0) .fill 7 + EXTRA_STACK, 4  /* 7 registers: SPSR,r0-r4,lr */
#endif  /* _WRS_OSM_INIT */
```

##### 2.2.2.2 宏\_ARM_PER_CPU_ADRS_GET

宏\_ARM_PER_CPU_ADRS_GET 的目的是获取全局变量 deltaKernelVars[VX_MAX_SMP_CPUS]中保存处理器异常状态栈基址的成员变量的地址。注意该全局变量是一个结构体数组，每个处理器核对应数组中的一个成员。deltaKernelVars 和结构体 WIND_VARS 的定义如下（只列出了这次需要获取的成员）：

```c
WIND_VARS  _WRS_VX_KERNEL_VARS_SECTION_ATTR deltaKernelVars[VX_MAX_SMP_CPUS];

typedef struct windVars
{
    _WIND_VARS vars;
} WIND_VARS;

typedef struct _windVars
{
...
#ifdef _WRS_WIND_VARS_ARCH
    /*
     * _WRS_WIND_VARS_ARCH macro-definition can be used for specifying
     * architecture an specific fields for WIND_VARS.
     */
    _WRS_WIND_VARS_ARCH;	       /* 0x4c/0x70: architecture specific   */
#endif /* _WRS_WIND_VARS_ARCH */
} _WIND_VARS _WRS_DATA_ALIGN_BYTES (_WRS_WIND_VARS_ALIGN);

#define _WRS_WIND_VARS_ARCH WIND_VARS_ARCH cpu_archVars

typedef struct wind_vars_arch
{
...
    char *   cpu_undefSaveArea;
    char *   cpu_abortSaveArea;
    char *   cpu_swiSaveArea;
    char *   cpu_irqStack;
...
} WIND_VARS_ARCH;
```

\_ARM_PER_CPU_ADRS_GET 的定义如下：

```c
#define _ARM_PER_CPU_ADRS_GET(r, scratch, label)            \
    _ARM_CPU_INDEX_GET(r)                                   ; \
    LDR  scratch, L$_vxKernelVars                           ; \
    ADD  scratch, scratch, r, LSL ARM_WIND_VARS_ALIGN_SHIFT ; \
    ADD  r, scratch, ARM_HASH _ARM_WIND_VARS_OFFSET(label)  ; \
```

同样以未定义异常`_ARM_PER_CPU_ADRS_GET(r1, r2, undefSaveArea)`为例：

1. 首先获取处理器核的索引号保存在 r1 寄存器；
2. 标签 L\$\_vxKernelVars 处保存了 deltaKernelVars 的地址，通过`LDR scratch, L$_vxKernelVars`将 deltaKernelVars 的地址保存在 r2 中；

```c
L$_vxKernelVars:      .long   VAR(deltaKernelVars)
```

3. 结构体 WIND_VARS 以 128 字节对齐，因此将核索引号乘以 128 即可得到对应核的 WIND_VARS 结构体地址；
4. 再通过宏获取结构体成员 char \*cpu_undefSaveArea 的偏移为 0x4C+0xC=0x58，加上结构体变量基址后保存在 r1 寄存器中。

```c
#define _ARM_WIND_VARS_OFFSET(label) _WRS_WIND_VARS_OFFSET_##label
#define _WRS_WIND_VARS_OFFSET_undefSaveArea   \
                      (_WRS_WIND_VARS_OFFSET_archVars+0xC)
#define _WRS_WIND_VARS_OFFSET_archVars					\
					_WIND_VARS_cpu_archVars_OFFSET
#define _WIND_VARS_cpu_archVars_OFFSET    0x4C
```

##### 2.2.2.3 保存栈空间基址到全局变量

通过`str r0, [r1]`指令将异常模式的栈空间基址保存在刚刚获取的结构体成员的中。==注意，vxWorks 的汇编异常处理程序将栈以满增栈的形式使用，因此此处保存的是栈的低地址而非高地址。==

至此，Undefined，Abort，Swi(SVC)和 IRQ 模式的栈基址都保存在了全局变量 deltaKernelVars 中。

##### 2.2.2.4 切换模式设置 SP 寄存器

依次切换到 Undefined、Abort、和 IRQ 模式设置 SP\_<_mode_>寄存器。

```c
MRS r0, cpsr
BIC r1, r0, #MASK_MODE

ORR r1, r1, #I_BIT

/*
 * switch to each mode in turn with interrupts disabled and set SP
 * r0 = original CPSR
 * r1 = CPSR with IRQ/FIQ disabled and mode bits clear
 */

ORR r2, r1, #MODE_UNDEF32     /* do UNDEF mode */
MSR cpsr, r2

_ARM_PER_CPU_ADRS_GET_SP(sp, r2, undefSaveArea)

/*
 * The saveArea entry in vxKernelVars is a pointer to the address
 * so now we need to grab the actual address
 */

LDR sp, [sp]
```

仍然以 0 号核 Undefined 模式为例，读 CPSR 后将 M[4:0]置位 0x1B(即 Undefined 模式)，再写回 CPSR 就可实现模式切换。

通过宏\_ARM_PER_CPU_ADRS_GET_SP 将 SP\_*und*寄存器赋值为 deltaKernelVars[0].vars.cpu_archVars.cpu_undefSaveArea 的地址。

最后通过`LDR sp, [sp]`指令把 cpu_undefSaveArea 中的值加载到 SP\_*und*中，完成栈基址的设置。

```c
#define _ARM_PER_CPU_ADRS_GET_SP(r, scratch, label)         \
    _ARM_CPU_INDEX_GET_SP(r)                                ; \
    LDR  scratch, L$_vxKernelVars                           ; \
    ADD  scratch, scratch, r, LSL ARM_WIND_VARS_ALIGN_SHIFT ; \
    ADD  r, scratch, ARM_HASH _ARM_WIND_VARS_OFFSET(label)  ; \
```

注意调用 SVC 指令产生软中断进入的是 SVC 模式，与系统内核共用同一个 SP 寄存器，因此此处没有设置软中断的栈基址，仅保存在结构体中。

##### 2.2.2.5 设置 User 模式栈

切换回 SVC 模式，恢复栈中保存的寄存器后再将 0x0 入栈保存，通过`LDMFD sp, {sp}^`指令将 User 模式的 SP 置为 0，最后纠正 SVC 的栈指针（因为之前将 r1 入栈保存，而该值仅用于将 SP\_*usr*清零，无需出栈恢复），结束运行返回 excVecInit。==PS：使用 LDM 指令且寄存器列表中不含 PC 寄存器时，\^符号代表使用 User 模式的寄存器，即{sp}^表示 SP\__usr_==。

```c
MSR cpsr, r0

#if defined(_WRS_CONFIG_MULTI_CLUSTERS) && defined(_WRS_CONFIG_SMP)
ldmfd sp!, {r4 - r7}
#endif  /* _WRS_CONFIG_MULTI_CLUSTERS && _WRS_CONFIG_SMP */
/*
 **** INTERRUPTS RESTORED
 *
 * zero usr_sp - it should never be used
 */

MOV r1, #0
STMFD sp!, {r1}
#if (!ARM_THUMB2) /* User mode not supported for Thumb-2 */
LDMFD sp, {sp}^        /* Writeback prohibited */
#endif /* (!ARM_THUMB2) */
ARM_NOP_AFTER_USER_LDM_STM
ADD sp, sp, #4        /* correct SP */
MOV pc, lr
```

#### 2.2.3 构建中断异常向量表

构建流程是从 excEnterTbl 中读取各异常入口地址，在该地址处写入`LDR PC,[PC,#offset]`指令的机器码，并在向量表+excPtrTableOffset 处保存中断异常处理程序的地址，从而完成中断异常向量表的构建。

```c
for (i = 0; i < NUM_EXC_VECS; ++i)
{
	/*
	 * Each vector contains a LDR PC,[PC,#offset] instruction to
         * load the PC from an address stored in the exception pointer
         * table located at (exception vector base address + excPtrTableOffset)
	 */

	*(UINT32 *)excEnterTbl[i].vecAddr = SWAP32_BE8(0xE59FF000 | (excPtrTableOffset - 8 - FIRST_VECTOR));

	*(VOIDFUNCPTR *) (excEnterTbl[i].vecAddr + excPtrTableOffset - FIRST_VECTOR) = excEnterTbl[i].fn;
}
```

vxWorks 设计在内存的==向量表基址+excPtrTableOffset==处依次存放中断异常处理程序的地址，excPtrTableOffset 为 0x100。`LDR PC,[PC,#offset]`指令的目的就是转跳到对应的处理程序中。该机器码低 12 位为基于 PC 的偏移地址，需要计算后形成最终的机器码写入向量表。

偏移的计算方法是==- 0x8 + 0x100 + - 0x4==。\- 0x8 是因为 ARM 架构中 PC 指向当前执行指令后的第二条指令，即 PC 等于当前指令地址+8；加偏移 0x100 后减 0x4 是因为 Non-Secoure 状态下没有使用 Reset 中断，不需要对应的中断处理程序，Undefined Instruction 中断处理程序排在第一个，因此 Undefined Instruction 中断入口与其处理程序的偏移是 0x100 - 0x4。

填充完向量表后在 0x100 偏移处填充中断异常处理程序的地址，就完成了整个向量表的构建。

#### 2.2.4 设置 Reset 向量

如前所述，Non-Secoure 状态下没有使用 Reset 中断，因此在 Reset 向量的位置处填充了一条会导致未定义指令的机器码。

```c
rstHandlerAddr = (EXC_OFF_RESET + (excEnterTbl[0].vecAddr - FIRST_VECTOR));

*(UINT32 *)rstHandlerAddr = SWAP32_BE8(0xE7FDDEFE);
```

#### 2.2.5 刷新 Cache，记录默认中断处理程序

刷新中断异常向量表及处理程序处的 Cache；用全局变量\_func_armIrqHandler 记录默认中断处理程序 excIntHandle。

```c
CACHE_TEXT_UPDATE(rstHandlerAddr, EXC_TABLE_SIZE);
CACHE_TEXT_UPDATE(rstHandlerAddr + excPtrTableOffset, EXC_TABLE_SIZE);
```

### 2.3 usrKernelInit

usrKernelInit 中，会在内核初始化参数结构体 kIP 中保存系统中断栈的大小，以便后续分配、计算系统中断栈时使用。ARM 平台的宏 ISR_STACK_SIZE 在 BSP 的 config.h 文件中定义。

```c
kIP.intStackSize = ISR_STACK_SIZE;
```

#### 2.3.1 kernelInit

kernelInit 接口中会在 deltaKernelVars 的成员变量 cpu_vxIntStackBase 和 cpu_vxIntStackEnd 中保存各个核的系统中断栈基址和结束地址，后续处理中断时会使用该栈。

```c
for (i = 0; i < _WRS_CPU_CONFIGURED (); i++)
{
	char ** pVxIntStackEnd;
	char ** pVxIntStackBase;

...

	/* interrupt stack */

	pVxIntStackEnd  = &_WRS_KERNEL_CPU_GLOBAL_GET (i, vxIntStackEnd); /*获取cpu_vxIntStackEnd的地址*/
	pVxIntStackBase = &_WRS_KERNEL_CPU_GLOBAL_GET (i, vxIntStackBase); /*获取cpu_vxIntStackBase的地址*/

	*pVxIntStackEnd  = pMemPoolStart;
	*pVxIntStackBase = pMemPoolStart + pParams->intStackSize; /*保存系统中断栈*/

	if (!globalNoStackFill)
	    bfill (*pVxIntStackEnd, pParams->intStackSize, 0xee);

	pMemPoolStart = *pVxIntStackBase;

	*pVxIntStackBase -= deltaIntStackUnderflowSize;
	*pVxIntStackEnd  += deltaIntStackOverflowSize;

...
}  /* end for each CPU_CONFIGURED */
```

## 3.汇编中断处理程序 intEnt

当发生中断时，处理器会切换到 IRQ 模式，并跳转到中断异常向量表的 0x18 处，根据前面的分析可知 0x18 处为一条 LDR PC, [ ]指令，处理器会再跳转到 intEnt 中，本节将分析 intEnt 函数的相关操作。

### 3.1 保存 IRQ 模式上下文，切换到 SVC

进入中断时，LR_irq 寄存器的值为被中断指令的下一条指令的地址，因此 LR 寄存器的值需要减 4 以返回到正常的地址。此时的 SP 为 SP_irq，excVecInit 中已经设置过中断栈基址，可以直接使用。

将 R0-R4 和 LR_irq 寄存器入栈保存，SPSR 寄存器的内容是被中断时 CPSR 寄存器的值，中断返回时需要恢复，因此也入栈保存。

```c
/*
 * Entered directly from the hardware vector (via LDR pc, [])
 * Adjust return address so it points to instruction to resume
 */
SUB lr, lr, #4  /* adjust */

/* save regs on IRQ (or FIQ, if supported) stack */

STMFD sp!, {r0 - r4, lr}
MRS	r0, spsr
STMFD sp!, {r0}
```

将 SP_irq 保存在 R2 中，然后将处理器切换到 SVC 模式并关闭中断。

```c
/* save sp in non-banked reg so can access saved regs from SVC mode */

MOV	r2, sp

/*
 * switch to SVC mode with IRQs disabled (they should be already)
 * Note this can be done without clearing the mode bits before ORRing
 */

MRS	r1, cpsr
BIC r1, r1, #MASK_MODE
ORR	r1, r1, #(MODE_SVC32 | I_BIT)
MSR	cpsr, r1
```

### 3.2 记录中断嵌套层数

通过宏\_ARM_PER_CPU_VALUE_AND_ADRS_GET 获取 deltaKernelVars 中成员变量 cpu_intNestingLevel 的地址（保存在 R3）和值（保存在 R0）， 加 1 后写回 cpu_intNestingLevel，以记录中断嵌套层数。

获取 deltaKernelVars 中成员变量 cpu_maxIntNestingLevel 的值并与 cpu_intNestingLevel 比较，如果 cpu_intNestingLevel 较大则更新 cpu_maxIntNestingLevel。

```c
	/* r3 = &intNestingLevel */
	/* r0 = intNestingLevel */
	_ARM_PER_CPU_VALUE_AND_ADRS_GET(r0, r3, intNestingLevel)
	ADD	r0, r0, #1
	STR	r0, [r3]

#ifdef CHECK_NESTING
	_ARM_PER_CPU_VALUE_GET (r1, r3, maxIntNestingLevel)
	CMP	r0, r1
	BLS	not_deeper
	_ARM_PER_CPU_ADRS_GET (r1, r3, maxIntNestingLevel)
	STR     r0, [r1]       /* update with the larger value */
not_deeper:
```

### 3.3 判断是否切换到系统中断栈

将 SVC 模式的栈 SP_svc 保存在 R1 中；根据 cpu_intNestingLevel 判断当前是否处在中断嵌套中（TEQ 指令进行异或操作），如果已经处于嵌套状态则说明栈已经切换过，无需再切换，否则通过宏\_ARM_PER_CPU_VALUE_GET_SPLR 将 SP_svc 切换为 deltaKernelVars 成员变量 cpu_vxIntStackBase 的值，该变量保存了系统中断栈基址，在 kernelInit 接口中初始化，请参考本文[2.3.1](#2.3.1 kernelInit)节。

```c
/* switch to SVC-mode interrupt stack if not already using it */

	MOV	r1, sp				/* save svc_sp */
	TEQ	r0, #1				/* first level of nesting? */

	BNE     not_first_level
	_ARM_PER_CPU_VALUE_GET_SPLR (sp, r4, deltaIntStackBase)
not_first_level:
```

### 3.4 保存 SVC 模式上下文到系统中断栈

获取 cpu_errno 的值以及 cpu_intCnt 的地址，此时 R0=cpu_errno，R1=SP_svc，R2=SP_irq，R3=&cpu_intCnt。

```c
_ARM_PER_CPU_VALUE_GET (r0, r4, errno)
_ARM_PER_CPU_ADRS_GET (r3, r4, intCnt)

STMFD sp!, {r0-r2,r12,lr}

LDR	lr, [r3]	/* increment kernel interrupt counter */
ADD	lr, lr, #1
STR	lr, [r3]
```

将 R0-R2，R12，LR_svc 入栈保存；将 cpu_intCnt 的值加 1 后写回 cpu_intCnt 中。

==此处保存上下文的目的是为下一步调用 C 语言中断处理程序做准备，由于编译器会将 R4-R11 寄存器按需入栈保存，因此调用 C 函数只需要将 R0-R3，IP(R12)和 LR 入栈保存即可（此处 R3 的值无需保留，所以不需要入栈）。==

### 3.5 进入 C 语言中断处理程序

通过 L$\_\_func_armIrqHandler 将全局变量\_func_armIrqHandler 的地址加载到 r0 寄存器，\_func_armIrqHandler 指向 C 语言编写的中断处理程序，excVecInit 中初始化为 excIntHandle。GIC 驱动初始化时通过代码`EXC_CONNECT_INTR_RTN (vxbArmGicNonPreempISR);`将中断处理程序修改为 vxbArmGicNonPreempISR。

将汇编接口 intExit 的地址加载到 LR_svc 中，这样 C 语言处理程序指向完成后可以直接返回到 intExit 中。

最终向 PC 加载\_func_armIrqHandler 保存的地址，进入 C 语言中断处理程序。

```c
LDR r0, L$__func_armIrqHandler /* get IRQ handler pointer */
ADR lr, FUNC(intExit)   /* set return address */
LDR pc, [r0]
```

### 3.6 小结

intEnt 的主要工作是产生中断进入 IRQ 模式时，保存基础上下文（R0-R4，PC，SPSR），然后切换到 SVC 模式，并将 SP_svc 切换到系统中断栈，再次保存基础上下文后调用 C 语言编写的中断处理程序。以上操作都是在关中断的状态下进行的。

## 4. 中断处理程序 vxbArmGicNonPreempISR

GICv2 的结构及编程模型在另外的文档专门描述，本章节仅分析 GICv2 驱动安装的中断处理程序 vxbArmGicNonPreempISR。

vxbArmGicNonPreempISR 中首先调用 vxbArmGicLvlVecChk，该接口读取 GICC_IAR 寄存获取处于 pending 状态的优先级最高的中断号，并将中断号通过 level 和 vector 变量返回，==读 GICC_IAR 寄存器即是中断响应操作，中断会从 pending 状态变为 active 状态。==如果是 SGI 中断还会通过 srcCpuId 返回发送 SGI 中断的处理器核 ID。注意，对于 SGI 中断，该接口会将中断号加上中断控制器支持的最大中断号 armGicLinesNum，对 SGI 中断号进行了重新定义。

```c
if (vxbArmGicLvlVecChk (pVxbArmGicDrvCtrl->pInst, &level, &vector, &srcCpuId) == ERROR)
{
    return;
}
```

接着程序会循环检查并调用每个中断对应的真实处理程序，直到没有中断处于 pending 状态。

```c
do
{
    /* Loop until no more interrupts are found */

    /* 根据中断号调用安装的中断处理程序 */
    VXB_INTCTLR_ISR_CALL (&(pVxbArmGicDrvCtrl->isrHandle), vector)

    /* acknowledge the interrupt and restore interrupt level */

    /* 写GICC_EOIR寄存器，表示完成中断处理 */
    vxbArmGicLvlVecAck (pVxbArmGicDrvCtrl->pInst, level, vector, srcCpuId);
} while (vxbArmGicLvlVecChk (pVxbArmGicDrvCtrl->pInst, &level, &vector, &srcCpuId) != ERROR);
```

真实中断处理的获取方法是通过中断号索引保存在 pVxbArmGicDrvCtrl->isrHandle->pTop 中的两级中断表，从而获取驱动安装的真实的中断处理程序。关于 vxWorks 的中断表结构会在 GIC 驱动文档中详细分析。

```c
#define VXB_INTCTLR_ISR_CALL(ent, inpPin)                          \
{                                                              \
    FAST int tblIndx = (inpPin >> VXB_INTCTLRLIB_LOWLVL_SIZE_POW); \
    FAST int pinIndx = inpPin & (VXB_INTCTLRLIB_LOWLVL_SIZE - 1);  \
    FAST struct vxbIntCtlrPin * pPin =                             \
                    &((ent)->pTop->tbl[tblIndx]->pins[pinIndx]);   \
    FAST void * pArg = pPin->pArg;                                 \
    FAST int pinFlags = pPin->pinFlags;                            \
    /*                                                             \
     * In order to generate minimum instructions from              \
     * ppcIntCtlrISR_INTR() for PPC with -Xlocals-on-stack option  \
     * by the current Diab compiler, Ver5.6.0.0, don't assign pIsr \
     * to a regsiter.                                              \
     */                                                            \
    void (*pIsr)(void *, int) = pPin->isr;                         \
    (*pIsr)(pArg, pinFlags);                                       \
}
```

需要注意的是，此处的*pIsr*通常不是真正的设备中断处理程序，而是二次派发接口*isrDispatcher*，该接口会解析类型为*ISR_ID*的*pArg*，从而调用真实的设备中断处理程序。

完成中断处理程序调用后必需调用 vxbArmGicLvlVecAck 写 GICC_EOIR 寄存器，以告知处理器中断处理完成。

注意，从开始中断处理到 vxbArmGicNonPreempISR 接口执行完毕都没有使能处理器中断。

## 5. 汇编中断退出程序 intExit

根据[3.5](# 3.5 进入 C 语言中断处理程序)章节的分析可知 vxbArmGicNonPreempISR 执行完毕后会直接返回到 intExit 中。注意此时的 SP_svc 指向系统中断栈，已入栈保存的内容是 cpu_errno，SP_svc，SP_irq，R12 和 LR_svc，可参考[3.4](# 3.4 保存上下文到系统中断栈)章节。

### 5.1 关中断，恢复 cpu_errno

首先读取 CPSR 寄存器，将 I 位置 1 后写回以关闭 IRQ 中断。再将栈中保存的 cpu_errno 出栈，恢复到 deltaKernelVars 中。

```c
/* disable IRQs */

MRS r1, cpsr
ORR r1, r1, #I_BIT
MSR cpsr, r1

/* INTERRUPTS DISABLED */
/* restore errno from stack */

LDMFD sp!, {lr}
_ARM_PER_CPU_ADRS_GET(r0, r1, errno)
STR lr, [r0]      /* restore errno */
```

### 5.2 判断是否处于中断嵌套

获取 cpu_intNestingLevel，判断是否处于中断嵌套中（该值在进入中断时增加，请参考[3.2](# 3.2 记录中断嵌套层数)章节），如果是则跳转到 intExit_RTI 执行中断退出，请参考[5.6](# 5.6 退出流程 intExit_RTI)章节。

```c
_ARM_PER_CPU_VALUE_GET (r0, lr, intNestingLevel)
CMP	r0, #1
BGT	intExit_RTI
```

### 5.3 判断中断发生时的处理器模式

从栈中取出 IRQ 模式下的栈指针，再从该栈取出进入中断时保存的 SPSR 寄存器的值。

取 SPSR 的后 4 位，即 M[3:0]（M[4]恒为 1，因此忽略了），判断中断发生时处理器所处的模式；如果是 SVC 或 USR 模式跳转到 cont_intExit 执行，否则跳转到 intExit_RTI，请参考[5.6](# 5.6 退出流程 intExit_RTI)章节。

```c
    LDR lr, [sp, #4]                    /* get irq_sp */
    LDR lr, [lr]                        /* get irq_SPSR */

    AND lr, lr, #MASK_SUBMODE           /* check mode bits */

    TEQ lr, #MODE_SVC32 & MASK_SUBMODE  /* if !SVC(3), check for USR */
    BEQ cont_intExit

    TEQ lr, #MODE_USER32 & MASK_SUBMODE /* if USR (0), cont_intExit */
    BNE intExit_RTI                     /* if not SVC or USR, RTI */

cont_intExit:
```

### 5.4 判断是否持有内核锁

通过宏\_ARM_KERNEL_LOCK_OWNER_AND_INDEX_GET 获取内核锁全局变量 kernelStateLock.cpuIndex，以及当前处理器核的索引号。从而判断内核锁是否由当前处理器核持有，如果是当前核持有则转跳到 intExit_RTI 执行中断退出。

```c
/* local interrupts are locked */

/*
 * r0 = kernel lock owner
 * r1 = current cpu index
 */

_ARM_KERNEL_LOCK_OWNER_AND_INDEX_GET(r0, r1)
CMP r0, r1		/* myself kernel lock owner? */
BEQ intExit_RTI	/* if yes, just return */
```

### 5.5 判断是否需要调度和执行 workQ

获取 cpu_taskIdCurrent（当前任务 ID），保存在 r0 中，后续如果需要跳转到 saveIntContext 时会使用。

获取 cpu_reschedMode 的值，如果值不为 0（即 WIND_NO_RESCHEDULE）说明需要进行调度，则跳转到 saveIntContext 处保存保存中断上下文并进行调度，请参考[5.7](# 5.7 saveIntContext)章节。

如果无需调度，则判断 cpu_workQIsEmpty 的值是否为 0，不为 0 说明 workQ 为空，跳转到 intExit_RTI 执行中断退出流程，否则就使能中断，调用 kernelLockTake 获取内核锁，再调用 workQDoWork 执行 workQ 中的所有 work。

```c
    _ARM_PER_CPU_VALUE_GET(r0, lr, taskIdCurrent)    /* 跳转到saveIntContext执行才会使用r0 */

    _ARM_PER_CPU_VALUE_GET(r1, lr, reschedMode)
    TEQ r1, #0
    BNE saveIntContext

    /* local interrupts are locked: check whether workQ is empty or not */

    _ARM_PER_CPU_VALUE_GET(r0, lr, workQIsEmpty)
    TEQ r0, #0      /* test for work to do */
    BNE intExit_RTI /* if no, exit with RTI */

    /* unlock local interrupts */

    MRS r0, cpsr
    BIC r0, r0, #I_BIT
    MSR cpsr, r0

    /* take the kernel lock */

    BL FUNC(kernelLockTake)
emptyWorkQueue:
    /* Drain the workQ since there are jobs */

    BL FUNC(workQDoWork)
```

执行完 workQDoWork 后再次关中断，检查 cpu_workQIsEmpty 的值，如果 workQ 中又存在 work 则跳回 emptyWorkQueue 处再次执行；workQ 为空则释放内核锁，检查 cpu_reschedMode，无需调度则跳转到 intExit_RTI，否则跳转 saveIntContext。

```c
/* re-lock local interrupts before emptying workQ */

MRS r0, cpsr

ORR r0, r0, #I_BIT

MSR cpsr, r0

_ARM_PER_CPU_VALUE_GET(r0, lr, workQIsEmpty)
TEQ r0, #0          /* test for work to do */
BEQ emptyWorkQueue      /* workQ is not empty */

* exit kernel (kernelState = FALSE) -- release the spin lock */

BL FUNC(kernelLockGive)

/*
 * Local interrupts are locked and workQ is empty.
 * Recheck "reschedMode":
 * Branch to "saveIntContext" if it's not WIND_NO_RESCHEDULE
 * (state changed), otherwise branch to "intExit_RTI".
 */

_ARM_PER_CPU_VALUE_GET(r0, lr, reschedMode)
TEQ r0, #0
BEQ intExit_RTI

_ARM_PER_CPU_VALUE_GET(r0, lr, taskIdCurrent)
B saveIntContext
```

### 5.6 退出流程 intExit_RTI

获取 cpu_intCnt，cpu_intNestingLevel 的地址，分别减 1 后写回。

```c
_ARM_PER_CPU_ADRS_GET (r0, lr, intCnt)
_ARM_PER_CPU_ADRS_GET (r1, lr, intNestingLevel)

LDR	lr, [r0]
SUB	lr, lr, #1
STR	lr, [r0]

LDR	lr, [r1]
SUB	lr, lr, #1
STR	lr, [r1]
```

从系统中断栈中恢复 SVC 模式的上下文，R1 为 SP_svc，R2 为 SP_irq，R12、LR 为 SVC 模式的原始值。

将 R1 赋值给 SP_svc，完成 SVC 模式栈的恢复；修改 CPSR 寄存器，在关中断的情况下返回 IRQ 模式。

```c
/*
 * IRQs still disabled
 * restore SVC-mode regs before changing back to IRQ mode
 */

LDMFD sp!, {r1-r2, r12, lr}

/*
 * r1  = svc_sp (original)
 * r2  = irq_sp/fiq_sp
 * r12 = svc_r12 (original)
 * lr  = svc_lr (original)
 *
 * SVC-mode interruptStack now flattened
 * Switch SVC-mode stack back to what it was when the IRQ occurred
 */

MOV	sp, r1

/* return to IRQ mode with IRQs disabled */

MRS	r0, cpsr
BIC	r0, r0, #MASK_MODE
ORR	r0, r0, #(MODE_IRQ32 | I_BIT)
MSR	cpsr, r0
```

在 IRQ 状态下，将 SPSR 的值从 SP_irq 中出栈，通过宏\_ARM_SPSR_SET 写入 SPSR 寄存器。

从 SP_irq 中将保存的中断上下文全部出栈，恢复到被中断的状态继续运行，至此完成全部的中断处理。此处的汇编语法需要注意，当批量 Load 指令的寄存器列中有 PC 寄存器时，==^==符号表示将 SPSR 寄存器的内容恢复到 CPSR 寄存器中；寄存器列表中没有 PC 时，^表示在 SVC 模式下访问 USR 模式的寄存器。

```c
LDMFD	sp!, {r0}  /* restore SPSR */

_ARM_SPSR_SET(r0)

/* pull r0-r4, and PC from IRQ/FIQ stack and return */
LDMFD	sp!, {r0-r4, pc}^	/* restore regs and return from intr */
```

### 5.7 调度流程 saveIntContext

进入此分支说明 cpu_reschedMode 被置位非 0 的值，即需要进行任务调度，此时 R0 寄存器的值为当前任务 ID（cpu_taskIdCurrent），SP_svc 为系统中断栈。

将在[3.4](# 3.4 保存 SVC 模式上下文到系统中断栈)章节保存在系统中断栈中的内容出栈，并切换回 SVC 模式原始的栈。

```c
LDMFD	sp!, {r1-r2, r12, lr}

/*
 * r0 -> TCB
 * r1  = svc_sp (original)
 * r2  = irq_sp/fiq_sp
 * r12 = svc_r12 (original)      * lr  = svc_lr (original)

 * SVC-mode interruptStack now flattened
 * Switch SVC-mode stack back to what it was when the IRQ/FIQ occurred
 */

MOV	sp, r1	/* restore original svc_sp */
```

将&(cpu_taskIdCurrent->regs.r[5])赋值给 R1；从 SP_irq 中获取 SPSR 的值，根据 M[3:0]判断中断发生时是否是 USR 模式，如果不是则跳转到 skip_usr 处。

cpu_taskIdCurrent->regs 的类型为 REG_SET，定义如下所示：

```c
typedef struct			/* REG_SET - ARM register set */
{
    ULONG r[GREG_NUM];		/* general purpose registers 0-14 */
    INSTR *pc;			/* program counter */
    ULONG cpsr;			/* current PSR */
    ULONG ttbase;		/* Trans Table Base */
} REG_SET;
```

无论是 USR 模式还是 SVC 模式，都会将==R5-R12，SP 和 LR==寄存器保存在 cpu_taskIdCurrent->regs 中，差别是 USR 模式需要使用^符号保存 USR 模式下的寄存器。

```c
    LDR r3, [r2]                /* get task's CPSR from IRQ/FIQ stack */

    ADD r1, r0, #WIND_TCB_R5            /* r1 -> regs.r[5] */
    AND r3, r3, #MASK_SUBMODE           /* EQ => USR mode */
    TEQ r3, #MODE_USER32 & MASK_SUBMODE /* USR (0) */
    BNE skip_usr
    STMIA r1, {r5-r12, sp, lr}^             /* store r5-r12, usr_[sp,lr] */
    B skip_svc
skip_usr:
    /* SVC MODE */
    STMIA r1, {r5-r12, sp, lr} /* store r5-r12, svc_[sp,lr] */
```

从 SP_irq 中取出==CPSR，R0-R4，PC==，放入 R4-R10 中，再分别保存到 cpu_taskIdCurrent->regs。

读取 TTBR0 寄存器，获取页表基地址，保存到 cpu_taskIdCurrent->regs.ttbase，至此完成了任务所有上下文的保存工作。

```c
skip_svc:
    /* pull CPSR, r0-r4, and PC from IRQ/FIQ stack */

    LDMIA r2, {r4-r10}                    /* get task's CPSR,r0-r4,PC */
    STR r4, [r0, #WIND_TCB_CPSR]        /* put CPSR in TCB */
    STMDB r1, {r5-r9}                     /* put r0-r4 in TCB */ /* 注意此处使用的是STMDB指令 */
    STR  r10, [r0, #WIND_TCB_PC]         /* put PC in TCB */

    MRC CP_MMU, 0, r1, c2, c0, 0   /* get CP_15_TTBase */
    STR r1, [r0, #WIND_TCB_TTBASE] /* write to TCB */
```

由于调度器使用的是 Idel 任务的异常栈，因此将 R0 改为 Idle 任务 ID（cpu_idleTaskId）。

获取 cpu_idleTaskId->excCnt 的值，为 0 说明需要把栈切换到 Idle 任务的异常栈（cpu_idleTaskId->pExcStackBase），切换后将 ecxCnt 加 1 并写回保存；为 1 说明已经在使用该栈，无需再进行切换。

```c
/*
 * For SMP, the scheduler runs on idle task's exception stack, so
 * r0 becomes idleTaskId.
 */

_ARM_PER_CPU_VALUE_GET(r0, r3, idleTaskId)

/* reset svc_sp to base of exception stack */

LDR r3, [r0, #WIND_TCB_EXC_CNT]       /* get excCnt */

TEQ r3, #0                            /* already on exc stack? */
LDREQ sp, [r0, #WIND_TCB_P_K_STK_BASE]  /* no? switch to exc stack */

ADD r3, r3, #1                        /* increment excCnt */
STR r3, [r0, #WIND_TCB_EXC_CNT]       /* and store in TCB */
```

修改 CPSR 寄存器，切换到 IRQ 模式，将 SP_irq 加上 4\*7，把 SP_irq 恢复到进入中断前的状态（IRQ 栈中的寄存器都已保存到 cpu_taskIdCurrent->regs，可以丢弃[3.1](# 3.1 保存 IRQ 模式上下文，切换到 SVC)章节中保存的 7 个寄存器），再切换回 SVC 模式。

注意切换模式的过程中都是关中断的。

```c
MRS r1, cpsr            /* save mode and intr state */
BIC r3, r1, #MASK_MODE
ORR r3, r3, #MODE_IRQ32 | I_BIT /* interrupts still disabled */
MSR cpsr, r3
ADD sp, sp, #4*7   /* flatten stack */

/* back to SVC mode, IRQs still disabled */

ORR r1, r1, #I_BIT                  /* interrupts still disabled */
MSR cpsr, r1   /* r1 = CPSR */
```

开中断，获取内核锁后关中断。

```c
MRS r1, cpsr
BIC r1, r1, #I_BIT
MSR cpsr, r1

BL FUNC(kernelLockTake)

MRS r1, cpsr
ORR r1, r1, #I_BIT
MSR cpsr, r1	/* r1 = CPSR */
```

将 cpu_intCnt 和 cpu_intNestingLevel 清零，开中断，调用 reschedule 进行任务调度，该接口不会返回。

```c
_ARM_PER_CPU_ADRS_GET (r2, lr, intCnt)
_ARM_PER_CPU_ADRS_GET (r3, lr, intNestingLevel)

MOV	lr, #0
STR	lr, [r2]
STR	lr, [r3]

BIC r1, r1, #I_BIT   /* enable interrupts */
MSR	cpsr, r1

B FUNC(reschedule)
```

### 5.8 小结

intExit 除了体系结构相关的操作外，与系统内核结合较为紧密，程序会通过判断中断嵌套、是否需要调度，workQ 队列状态等进入不同的分支执行。

根据代码分析可以发现，中断发生在无需调度，workQ 队列为空的情况下，中断处理全程处于关中断状态，不会产生中断嵌套。只有在执行 workQDoWork 和 reschedule 时才会使能中断，可能会发生中断嵌套。因此 intEnt 中并未保存全部上下文，而是在 intExit 中确认需要进行调度时才将所有上下文保存在对应任务的结构体 cpu_taskIdCurrent->regs 成员中。

SMP 模式下 intExit 代码的流程图如下所示：

```c
Current SMP version:

Flow to exit interrupt service routine:

                    intExit()
                       |
              lock local interrupts
             __________|____________
            /                       \
            |                       |
            | kernel lock taken     | kernel lock not taken by myself
            | by myself             | AND not Nested interrupt
            v OR Nested             v
            |                       |
       intExit_RTI                  |
            |                       |
    (decrement int counter &        |
     restore regs          &        |
     rfi)                           |
                               (fast path?)
                                    |
                       !reschedMode |   reschedMode
                      ______________|__________________
                     /                                 \
                     |                                 | no fast path
                     v < check workQ >                 v
               ______|_____                            |
  workQ empty /            \ not empty                 |
              |            |                 |->  saveIntContext
         intExit_RTI       |                 |         |
                           |                 |  switch stacks if necessary
                 unlock local interrupts     ^         |
                           |                 |  unlock local interrupts
                    take kernel lock         |         |
                           |                 |  take kernel lock
                 lock local interrupts       |         |
                           |                 |  lock local interrupts
                     emptyWorkQueue          |         |
                           |                 |  zero out intCnt &
                   give kernel lock          |          intNestingLevel
                           |                 ^         |
                      (fast path?)           |   reschedule()
                           |                 |         |
             !reschedMode  | reschedMode     |         |
                       ____|____             |  coreLoadContext()
                      /         \            |
                      |         |            |
                 intExit_RTI    -------->-----
```

---

[^1]: #define SYS_HW_INIT_0() (sysHwInit0())
