<div align='center'><font size=8>QEMU虚拟机启动64位道系统</font></div>

<div align="center">
    <img src="https://img.shields.io/badge/Platform-QEMU | AArch64 | DeltaOS-008DB6?style=flat&logo=Arch Linux">
    <img src="https://img.shields.io/badge/Version-v1.3-99CC33?style=flat&logo=Git">
    <img src="https://img.shields.io/badge/Date-2023.03.31-FF6384?style=flat&logo=Crayon">
    <img src="https://img.shields.io/badge/License-Coretek-ffb71b?style=flat&logo=Coursera">
    <img src="https://shields.io/badge/WriteBy-Tidus-31C48D?style=flat&logo=Ghostery">
</div>

## 📡1.Linux 网络配置

### 🪐TAP+NAT 模式

在 Linux 中创建 TAP 设备并开启 NAT，可以实现 QEMU 虚拟机与 Linux 主机的网络互通以及虚拟机访问互联网。配置的主要步骤如下：

1. 创建网桥*br0*和 TAP 设备*tap0*
2. 为*br0*添加 IP 地址*10.0.2.1*
3. 开启 Linux 系统 IP 转发
4. 允许网桥*br0*转发的数据包通过防火墙
5. 开启 NAT 功能

QEMU Virt BSP 中提供了下列命令的可执行脚本文件，名为*config_net_nat.sh*

> 注意：
>
> 1.请根据您网络环境的实际情况修改网桥 IP 地址与网卡名
>
> 2.一个 TAP 设备仅供一个 QEMU 虚拟机使用，如需同时启动多个虚拟机，请创建多个 TAP 设备

```shell
sudo ip link add name br0 type bridge
sudo ip link set br0 up
sudo ip addr add 10.0.2.1/24 dev br0
sudo ip tuntap add tap0 mode tap
sudo ip link set tap0 up
sudo ip link set tap0 master br0
sudo sysctl -w net.ipv4.ip_forward=1
sudo iptables -t filter -A FORWARD -i br0 -j ACCEPT
sudo iptables -t filter -A FORWARD -o br0 -j ACCEPT
sudo iptables -t nat -A POSTROUTING -o ens33 -j MASQUERADE
```

### 🌉TAP+Bridge 模式

也可以采用 Bridge 模式进行网络配置，这种方法将 Linux 的网卡与 TAP 设备同时绑定在网桥上，QEMU 虚拟机的 IP 与 Linux 网卡 IP 在同一网段中。具体步骤如下：

1. 创建网桥*br1*和 TAP 设备*tap1*
2. 将物理网卡*ens33*和*tap1*绑定到网桥*br1*上
3. 将*ens33*的 IP 地址设置在网桥*br1*上
4. 设置默认路由且使用 br1 作为接口
5. 开启 Linux 系统 IP 转发
6. 允许网桥*br1*转发的数据包通过防火墙

> 请根据您网络环境的实际情况修改物理网卡名和所需网络地址

```shell
sudo ip link add name br1 type bridge
sudo ip link set br1 up
sudo ip tuntap add mode tap tap1
sudo ip link set tap1 up
sudo ip link set tap1 master br1
sudo ip link set dev ens33 master br1
sudo ip addr flush dev ens33
sudo ip addr add 192.168.213.129/24 dev br1
sudo ip route add default via 192.168.213.2 dev br1
sudo sysctl -w net.ipv4.ip_forward=1
sudo iptables -t filter -A FORWARD -i br1 -j ACCEPT
sudo iptables -t filter -A FORWARD -o br1 -j ACCEPT
```

### 🤖DHCP 服务

DeltaOS 可通过 DHCP 服务器自动获取 IP 地址，下列步骤以 ArchLinux 为例配置和开启 DHCP Server，不同的 Linux 发行版实际操作会有一定差别：

> 安装 DHCP 服务端

```shell
sudo pacman -S dhcp
```

> 编辑/etc/dhcpd.conf 文件，

```shell
sudo vim /etc/dhcpd.conf
```

> 在 dhcpd.conf 中输入以下内容

```shell
option domain-name-servers 192.168.213.2;   #DNS服务器地址，可通过/etc/resolv.conf文件获取
option subnet-mask 255.255.255.0;           #子网掩码

subnet 10.0.2.0 netmask 255.255.255.0 {     #IP池
  range 10.0.2.4 10.0.2.250;
  option routers 10.0.2.1;                  #网关地址
}

#使用Bridge模式时的IP池
subnet 192.168.213.0 netmask 255.255.255.0 {
  range 192.168.213.100 192.168.213.110;
  option routers 192.168.213.2;
}
```

> 开启 DHCP Server

```shell
sudo systemctl start dhcpd4.service
```

> 设置 DHCP Server 随 Linux 启动

```shell
sudo systemctl enable dhcpd4.service
```

## 💾2.QEMU 磁盘镜像配置

当 QEMU 虚拟机内的 DeltaOS 需要存储设备时，可以在 Linux 中创建磁盘镜像文件，作为块设备挂载到 QEMU 虚拟机上。下面介绍两种磁盘镜像文件创建方法，分别是使用*qemu-img*工具创建 qcow2 格式的镜像文件和使用*dd*直接创建镜像文件。

qcow2 格式支持稀疏存储，具有压缩、快照、回滚、加密等功能，并可通过*qemu-img*工具转换为其他镜像格式，因此强烈推荐使用 qcow2 文件作为 QEMU 虚拟机的磁盘镜像。

### 💽qemu-img

> 创建 qcow2 镜像

```shell
qemu-img create -f qcow2 disk.qcow2 16G
```

> 挂载 qcow2 文件到 nbd 设备

```shell
sudo modprobe nbd max_part=16
sudo qemu-nbd -c /dev/nbd0 -f qcow2 disk.qcow2
```

> 创建分区和格式化

```shell
#根据需要对磁盘进行分区，分区表格式选择DOS
#注意创建分区后应将分区类型转换为0c W95 FAT32 (LBA)
sudo fdisk /dev/nbd0

#格式化分区为FAT32格式，以分为两个分区为例
sudo mkfs.fat /dev/nbd0p1
sudo mkfs.fat /dev/nbd0p2
```

> 挂载到目录

```shell
#挂载到目录即可进行读写操作
sudo mount /dev/nbd0p1 disk_p1_dir
```

> 卸载及断开 nbd 设备

```shell
sudo umount disk_p1_dir
sudo qemu-nbd -d /dev/nbd0
```

### ⛏️dd

也可以使用*dd*命令创建磁盘镜像，以下步骤创建了一个 1GB 的磁盘镜像并进行了分区和格式化：

```shell
#使用seek参数创建稀疏文件
dd if=/dev/zero of=./disk.img bs=1M seek=1024 count=0
```

> 创建分区

```shell
#按实际需要分区
fdisk disk.img
```

> 将镜像文件关联到 loop 设备

```shell
sudo losetup -Pf disk.img
```

> 格式化分区

```shell
#格式化分区为FAT32格式，以分为两个分区为例
sudo mkfs.fat /dev/loop0p1
sudo mkfs.fat /dev/loop0p2
```

> 挂载到目录

```shell
sudo mount /dev/loop0p1 disk_p1_dir
```

> 卸载及断开关联

```shell
sudo umount disk_p1_dir
sudo losetup -d /dev/loop0
```

> 注意:
>
> 1. QEMU 使用*dd*创建的镜像时，*-drive*参数的 format 应设置为*raw*
>
> 2. 使用*cp*命令复制稀疏文件时可能会复制文件的全部未压缩大小，请按如下方式进行复制：
>
>    _`cp --sparse=always source_file new_file`_

### 🥪 标准磁盘镜像

为了便于用户快速完成系统配置与启动，QEMU Virt BSP 中提供了一个已创建好的 qcow2 磁盘镜像文件(_disk.qcow2_)，可以直接挂载使用。该磁盘大小为**16GB**，使用 MBR 分区表，划分为 2 个主分区，每个分区大小为 8GB。分区 1 中存储有*cfg/userDB*用户数据库文件，详细信息请参考[🪪6.用户管理](##🪪6.用户管理)章节。磁盘镜像信息如下:

```shell
$ qemu-img info disk.qcow2
image: disk.qcow2
file format: qcow2
virtual size: 16 GiB (17179869184 bytes)
disk size: 328 KiB
cluster_size: 65536
Format specific information:
    compat: 1.1
    compression type: zlib
    lazy refcounts: false
    refcount bits: 16
    corrupt: false
    extended l2: false
```

## 🎇3.启动 DeltaOS

如果在 ARM64 位架构主机上运行 QEMU 虚拟机，可以通过开启 KVM 实现硬件辅助虚拟化，提高虚拟机性能(注意需要在主机启动固件中开启 SMMUv3)；非 ARM64 位架构主机不可开启 KVM，仅可使用 TCG 加速。

当启动多个虚拟机时，请注意修改命令行中的磁盘镜像文件、monitor 端口号、tap 设备名、MAC 地址等参数。

### 🛫 使用 KVM

```shell
qemu-system-aarch64 -name DeltaOS -machine type=virt,gic-version=host,its=on -cpu host -smp 8 -m 8192 \
-accel accel=kvm -nographic -rtc base=localtime -kernel DeltaOS.elf -monitor telnet::5555,server,nowait \
-drive if=none,file=./disk.qcow2,id=dosFS,format=qcow2 \
-device virtio-blk-device,drive=dosFS \
-netdev tap,id=tapnet,ifname=tap0,script=no,downscript=no,br=0 \
-device virtio-net-device,netdev=tapnet,mac=00:11:22:33:44:55
```

### 🐢 不使用 KVM

```shell
qemu-system-aarch64 -name DeltaOS -machine type=virt,gic-version=3 -cpu cortex-a72 -smp 8 -m 8192 \
-accel accel=tcg -nographic -rtc base=localtime -kernel DeltaOS.elf -monitor telnet::5555,server,nowait \
-drive if=none,file=./disk.qcow2,id=dosFS,format=qcow2 \
-device virtio-blk-device,drive=dosFS \
-netdev tap,id=tapnet,ifname=tap0,script=no,downscript=no,br=0 \
-device virtio-net-device,netdev=tapnet,mac=00:11:22:33:44:55
```

> 注：BSP 中的 dts 文件最多可支持启动 32 核

## 🛠️4.DeltaOS 网络配置

### 📟DHCP Client

在 DeltaOS 中可通过*ifconfig*命令开启或关闭网卡的 DHCP 功能:

```shell
cmd
#开启DHCP Client以自动获取IP
ifconfig virtioNet0 dhcp
#关闭DHCP Client
ifconfig virtioNet0 -dhcp
```

### 🔍 设置 DNS 服务器

通常可通过 DHCP 服务获取 DNS 服务器地址，如果 DHCP 服务端未配置 DNS 信息或需要更换 DNS 服务器地址，可使用以下命令:

```shell
cmd
sysvar set -o ipdnsc.primaryns 192.168.213.2
```

设置 DNS 后可通过*ping*命令进行验证：

```shell
$ ping -c 3 www.qq.com

Pinging 58.49.216.194 (58.49.216.194) with 64 bytes of data:
Reply from 58.49.216.194 bytes=64 ttl=51 seq=0 time=33ms
Reply from 58.49.216.194 bytes=64 ttl=51 seq=1 time=50ms
Reply from 58.49.216.194 bytes=64 ttl=51 seq=2 time=50ms

--- 58.49.216.194 ping statistics ---
3 packets transmitted, 3 received, 0% packet loss, time 2050 ms
rtt min/avg/max = 33/44/50 ms
```

### ✒️ 手动设置 IP 地址

不使用 DHCP 时，可通过*ifconfig*命令手动设置网卡 IP 地址：

```shell
cmd
ifconfig virtioNet0 inet 10.0.2.4 netmask 255.255.255.0
```

### 📖 设置路由表

可通过*route*命令对路由表进行设置，更多使用方法请参考帮助信息：

```shell
cmd
#显示路由表
route show
#添加默认IPv4默认网关
route add default 10.0.2.1
```

## 🚀5.性能优化

在 QEMU 虚拟机内运行 DeltaOS 时，需要在内核镜像的*usrPreKernelAppInit()*函数中调用*qemuVirtCpuOptimize()*，可优化虚拟机运行时的 CPU 占有率，大幅提升性能，代码如下:

```c
#include <qemuVirt.h>

void usrPreKernelAppInit (void)
{
	qemuVirtCpuOptimize ();
}
```

## 🪪6.用户管理

DeltaOS 具备用户认证与管理功能，适用于 Shell、FTP、Telnet、SSH 等服务登录时的身份验证。用户可根据使用需要创建登录账号，账号的密码通过指定长度的 Hash Key 计算后存储在文件中。

QEMU Virt BSP 自带了长度为 256 的 Hash Key，并提供了 Hash Key 生成工具(_HashKey.exe_)，用户可根据需要生成 256-1024 长度的随机 Hash Key，替换默认值，请注意妥善保管好 Hash Key 文件。

为了方便用户快速使用，QEMU Virt BSP 自带的标准 qcow2 镜像中已经预置了用户数据库文件(_/vtbd0a/cfg/userDB_)，该文件内保存了使用默认 Hash Key 创建的名为**_root_**的账号， 密码为**_123_**，用户可使用该账号登录系统 Shell、Telnet、FTP 等服务。用户还可以自行在系统中进行账号的创建和管理，具体操作请参考*user*命令的帮助信息。

## 💻7.在 Windows 中搭建 QEMU 环境

为了方便开发调试工作的开展，可以在 Windows 中安装 QEMU，创建虚拟机运行 DeltaOS。

### 🎮 安装 QEMU

在 Windows 中，可通过 MSYS2 安装或使用 QEMU 在 Windows 平台的安装包完成 QEMU 的安装，在易用性方面 MSYS2 更胜一筹，更值得推荐。

> 使用 MSYS2 安装 QEMU

1. 在[MSYS2 官网](https://www.msys2.org/)下载安装包，完成安装后在开始菜单选择**MSYS2 UCRT64**启动 MSYS2 环境

2. MSYS2 使用 Pacman 作为软件包管理工具，执行以下命令更新软件库信息并安装 QEMU

   ```shell
   pacman -Syu
   pacman -S mingw-w64-ucrt-x86_64-qemu
   ```

3. 可通过查询 QEMU 版本信息检查是否安装成功

   ```shell
   qemu-system-aarch64 -version
   ```

> 使用 QEMU 安装包直接安装

1. 在[QEMU 官网](https://qemu.weilnetz.de/w64/)下载 64 位版本安装包
2. 完成安装后，注意把 QEMU 安装目录加入到 Windows 的系统环境变量**Path**中，以支持在 CMD 或 PowerShell 中调用 QEMU

### 📫 安装 TAP 虚拟网卡

1. 点击[本链接](https://build.openvpn.net/downloads/releases/tap-windows-9.24.7-I601-Win10.exe)，下载 TAP-Windows 安装包并进行安装，完成后在 Windows 的网络连接面板中可看到**TAP-Windows Adapter V9**适配器，如果未出现，可在开始菜单中选择**TAP Windows**，再点击**Add a new TAP virtual ethernet adapter**进行添加
2. 将 TAP-Windows Adapter V9 适配器重命名为**tap0**
3. 如果需要同时运行多台虚拟机，请创建多个 TAP 虚拟网卡，并重命名为**tap*x***

### 🗝️ 网络配置

> DeltaOS 需要连接互联网

以 Windows 通过无线网卡连接 WiFi 为例：

1. 在 WLAN 适配器上单击右键选择**属性**，点击**共享**选项卡
2. 选中**允许其他网络用户通过此计算机的 Internet 连接来连接**前的对号
3. 在下方下拉菜单中选择**tap0**后点击确定

此时**tap0**的 IP 地址会被设置为 192.168.137.1，并已开启 DHCP 服务，DeltaOS 启动后开启 DHCP Client，网卡即可自动获取到 192.168.137.0 网段的 IP

> DeltaOS 无需连接互联网

将**tap0**的 IP 地址设置为 10.0.2.1，子网掩码设置为 255.255.255.0 即可；如需使 DeltaOS 自动获取 IP，需要在 Windows 上搭建 DHCP 服务器，例如可使用免费开源软件[Open DHCP Server](https://dhcpserver.sourceforge.net/)，服务器搭建方法请参考软件的使用手册。

> 多虚拟机网络连通

当启动了多个虚拟机且需要网络互通时，请在 Windows 的网络连接面板中按住<kbd>Ctrl</kbd>键，选中各虚拟机对应的 TAP 适配器，然后右击选择**桥接**，即可创建一个虚拟网桥，再给该网桥设置 IP 地址为 10.0.2.1，子网掩码为 255.255.255.0 即可。

### 🎊 启动 DeltaOS

打开 MSYS2 UCRT64 或 PowerShell，参考**[🐢 不使用 KVM](###🐢不使用KVM)**章节中的 QEMU 命令启动虚拟机。

> 注意事项

1. 由于在 Windows 中无法使用 KVM，需要在代码或 Shell 中调用*qemuVirtTrigger()*函数使网卡能够正常工作，请参考本文的[📜 附录](##📜附录)
2. 如果在 Windows 中开启了网络共享，并在 DeltaOS 中开启了 DHCP，则 DNS 服务器地址会被设置为 192.168.137.1，需要根据网络实际情况重新设置 DNS 服务器地址
3. 请参考[🚀5.性能优化](##🚀5.性能优化)章节优化虚拟机运行时的 CPU 占有率

---

## 📜 附录

### 🪳 已知问题

启动 QEMU 虚拟机时如果未使能 KVM，需要在系统内核代码或 Shell 中调用*qemuVirtTrigger (78)*，使能 KVM 时不存在该问题：

```c
#include <qemuVirt.h>

void usrAppInit (void)
{
    qemuVirtTrigger (78);
}
```

### 🌳Qemu Virt 设备树

```shell
/dts-v1/;

/ {
    interrupt-parent = <0x8001>;
    #size-cells = <0x2>;
    #address-cells = <0x2>;
    compatible = "qemu,virt";
    model = "Qemu Virt";

    psci {
        migrate = <0xc4000005>;
        cpu_on = <0xc4000003>;
        cpu_off = <0x84000002>;
        cpu_suspend = <0xc4000001>;
        method = "hvc";
        compatible = "arm,psci-0.2", "arm,psci";
    };

    memory@40000000 {
        reg = <0x00 0x40000000 0x02 0x00>;
        device_type = "memory";
    };

    platform@c000000 {
        interrupt-parent = <0x8001>;
        ranges = <0x0 0x0 0xc000000 0x2000000>;
        #address-cells = <0x1>;
        #size-cells = <0x1>;
        compatible = "qemu,platform", "simple-bus";
    };

    fw-cfg@9020000 {
        dma-coherent;
        reg = <0x0 0x9020000 0x0 0x18>;
        compatible = "qemu,fw-cfg-mmio";
    };

    virtio_mmio@a000000 {
        dma-coherent;
        interrupts = <0x0 0x10 0x1>;
        reg = <0x0 0xa000000 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a000200 {
        dma-coherent;
        interrupts = <0x0 0x11 0x1>;
        reg = <0x0 0xa000200 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a000400 {
        dma-coherent;
        interrupts = <0x0 0x12 0x1>;
        reg = <0x0 0xa000400 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a000600 {
        dma-coherent;
        interrupts = <0x0 0x13 0x1>;
        reg = <0x0 0xa000600 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a000800 {
        dma-coherent;
        interrupts = <0x0 0x14 0x1>;
        reg = <0x0 0xa000800 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a000a00 {
        dma-coherent;
        interrupts = <0x0 0x15 0x1>;
        reg = <0x0 0xa000a00 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a000c00 {
        dma-coherent;
        interrupts = <0x0 0x16 0x1>;
        reg = <0x0 0xa000c00 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a000e00 {
        dma-coherent;
        interrupts = <0x0 0x17 0x1>;
        reg = <0x0 0xa000e00 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a001000 {
        dma-coherent;
        interrupts = <0x0 0x18 0x1>;
        reg = <0x0 0xa001000 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a001200 {
        dma-coherent;
        interrupts = <0x0 0x19 0x1>;
        reg = <0x0 0xa001200 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a001400 {
        dma-coherent;
        interrupts = <0x0 0x1a 0x1>;
        reg = <0x0 0xa001400 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a001600 {
        dma-coherent;
        interrupts = <0x0 0x1b 0x1>;
        reg = <0x0 0xa001600 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a001800 {
        dma-coherent;
        interrupts = <0x0 0x1c 0x1>;
        reg = <0x0 0xa001800 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a001a00 {
        dma-coherent;
        interrupts = <0x0 0x1d 0x1>;
        reg = <0x0 0xa001a00 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a001c00 {
        dma-coherent;
        interrupts = <0x0 0x1e 0x1>;
        reg = <0x0 0xa001c00 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a001e00 {
        dma-coherent;
        interrupts = <0x0 0x1f 0x1>;
        reg = <0x0 0xa001e00 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a002000 {
        dma-coherent;
        interrupts = <0x0 0x20 0x1>;
        reg = <0x0 0xa002000 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a002200 {
        dma-coherent;
        interrupts = <0x0 0x21 0x1>;
        reg = <0x0 0xa002200 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a002400 {
        dma-coherent;
        interrupts = <0x0 0x22 0x1>;
        reg = <0x0 0xa002400 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a002600 {
        dma-coherent;
        interrupts = <0x0 0x23 0x1>;
        reg = <0x0 0xa002600 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a002800 {
        dma-coherent;
        interrupts = <0x0 0x24 0x1>;
        reg = <0x0 0xa002800 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a002a00 {
        dma-coherent;
        interrupts = <0x0 0x25 0x1>;
        reg = <0x0 0xa002a00 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a002c00 {
        dma-coherent;
        interrupts = <0x0 0x26 0x1>;
        reg = <0x0 0xa002c00 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a002e00 {
        dma-coherent;
        interrupts = <0x0 0x27 0x1>;
        reg = <0x0 0xa002e00 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a003000 {
        dma-coherent;
        interrupts = <0x0 0x28 0x1>;
        reg = <0x0 0xa003000 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a003200 {
        dma-coherent;
        interrupts = <0x0 0x29 0x1>;
        reg = <0x0 0xa003200 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a003400 {
        dma-coherent;
        interrupts = <0x0 0x2a 0x1>;
        reg = <0x0 0xa003400 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a003600 {
        dma-coherent;
        interrupts = <0x0 0x2b 0x1>;
        reg = <0x0 0xa003600 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a003800 {
        dma-coherent;
        interrupts = <0x0 0x2c 0x1>;
        reg = <0x0 0xa003800 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a003a00 {
        dma-coherent;
        interrupts = <0x0 0x2d 0x1>;
        reg = <0x0 0xa003a00 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a003c00 {
        dma-coherent;
        interrupts = <0x0 0x2e 0x1>;
        reg = <0x0 0xa003c00 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    virtio_mmio@a003e00 {
        dma-coherent;
        interrupts = <0x0 0x2f 0x1>;
        reg = <0x0 0xa003e00 0x0 0x200>;
        compatible = "virtio,mmio";
    };

    gpio-keys {
        #address-cells = <0x1>;
        #size-cells = <0x0>;
        compatible = "gpio-keys";

        poweroff {
            gpios = <0x8002 0x3 0x0>;
            linux,code = <0x74>;
            label = "GPIO Key Poweroff";
        };
    };

    pl061@9030000 {
        phandle = <0x8002>;
        clock-names = "apb_pclk";
        clocks = <0x8000>;
        interrupts = <0x0 0x7 0x4>;
        gpio-controller;
        #gpio-cells = <0x2>;
        compatible = "arm,pl061", "arm,primecell";
        reg = <0x0 0x9030000 0x0 0x1000>;
    };

    pcie@10000000 {
        interrupt-map-mask = <0x1800 0x0 0x0 0x7>;
        interrupt-map = <0x0 0x0 0x0 0x1 0x8001 0x0 0x0 0x0 0x3 0x4 0x0 0x0 0x0 0x2 0x8001 0x0 0x0 0x0 0x4 0x4 0x0 0x0 0x0 0x3 0x8001 0x0 0x0 0x0 0x5 0x4 0x0 0x0 0x0 0x4 0x8001 0x0 0x0 0x0 0x6 0x4 0x800 0x0 0x0 0x1 0x8001 0x0 0x0 0x0 0x4 0x4 0x800 0x0 0x0 0x2 0x8001 0x0 0x0 0x0 0x5 0x4 0x800 0x0 0x0 0x3 0x8001 0x0 0x0 0x0 0x6 0x4 0x800 0x0 0x0 0x4 0x8001 0x0 0x0 0x0 0x3 0x4 0x1000 0x0 0x0 0x1 0x8001 0x0 0x0 0x0 0x5 0x4 0x1000 0x0 0x0 0x2 0x8001 0x0 0x0 0x0 0x6 0x4 0x1000 0x0 0x0 0x3 0x8001 0x0 0x0 0x0 0x3 0x4 0x1000 0x0 0x0 0x4 0x8001 0x0 0x0 0x0 0x4 0x4 0x1800 0x0 0x0 0x1 0x8001 0x0 0x0 0x0 0x6 0x4 0x1800 0x0 0x0 0x2 0x8001 0x0 0x0 0x0 0x3 0x4 0x1800 0x0 0x0 0x3 0x8001 0x0 0x0 0x0 0x4 0x4 0x1800 0x0 0x0 0x4 0x8001 0x0 0x0 0x0 0x5 0x4>;
        #interrupt-cells = <0x1>;
        ranges = <0x1000000 0x0 0x0 0x0 0x3eff0000 0x0 0x10000 0x2000000 0x0 0x10000000 0x0 0x10000000 0x0 0x2eff0000 0x3000000 0x80 0x0 0x80 0x0 0x80 0x0>;
        reg = <0x40 0x10000000 0x0 0x10000000>;
        msi-parent = <0x800a>;
        dma-coherent;
        bus-range = <0x0 0xff>;
        linux,pci-domain = <0x0>;
        #size-cells = <0x2>;
        #address-cells = <0x3>;
        device_type = "pci";
        compatible = "pci-host-ecam-generic";
        msi-map = <0 0x800a 0 0x10000>;
        msi-map-mask = <0xffffffff>;
    };

    pl031@9010000 {
        clock-names = "apb_pclk";
        clocks = <0x8000>;
        interrupts = <0x0 0x2 0x4>;
        reg = <0x0 0x9010000 0x0 0x1000>;
        compatible = "arm,pl031", "arm,primecell";
    };

    pl011@9000000 {
        clock-names = "uartclk", "apb_pclk";
        clocks = <0x8000 0x8000>;
        interrupts = <0x0 0x1 0x4>;
        reg = <0x0 0x9000000 0x0 0x1000>;
        compatible = "arm,pl011", "arm,primecell";
    };

    pmu {
        interrupts = <0x1 0x7 0x4>;
        compatible = "arm,armv8-pmuv3";
    };

    intc@8000000 {
        phandle = <0x8001>;
        reg = <0x0 0x8000000 0x0 0x10000 0x0 0x80a0000 0x0 0xf60000>;
        #redistributor-regions = <0x1>;
        compatible = "arm,gic-v3";
        ranges;
        #size-cells = <0x2>;
        #address-cells = <0x2>;
        interrupt-controller;
        #interrupt-cells = <0x3>;
        its@8080000 {
            phandle = <0x800a>;
            reg = <0x00 0x8080000 0x00 0x20000>;
            msi-controller;
            compatible = "arm,gic-v3-its";
        };
    };

    flash@0 {
        bank-width = <0x4>;
        reg = <0x0 0x0 0x0 0x4000000 0x0 0x4000000 0x0 0x4000000>;
        compatible = "cfi-flash";
    };

    cpus {
        #size-cells = <0x0>;
        #address-cells = <0x1>;

        cpu@0 {
            reg = <0x0>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@1 {
            reg = <0x1>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@2 {
            reg = <0x2>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@3 {
            reg = <0x3>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@4 {
            reg = <0x4>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@5 {
            reg = <0x5>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@6 {
            reg = <0x6>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@7 {
            reg = <0x7>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@8 {
            reg = <0x8>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@9 {
            reg = <0x9>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@10 {
            reg = <0xa>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@11 {
            reg = <0xb>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@12 {
            reg = <0xc>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@13 {
            reg = <0xd>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@14 {
            reg = <0xe>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@15 {
            reg = <0xf>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@16 {
            reg = <0x100>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@17 {
            reg = <0x101>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@18 {
            reg = <0x102>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@19 {
            reg = <0x103>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@20 {
            reg = <0x104>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@21 {
            reg = <0x105>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@22 {
            reg = <0x106>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@23 {
            reg = <0x107>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@24 {
            reg = <0x108>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@25 {
            reg = <0x109>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@26 {
            reg = <0x10a>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@27 {
            reg = <0x10b>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@28 {
            reg = <0x10c>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@29 {
            reg = <0x10d>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@30 {
            reg = <0x10e>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };

        cpu@31 {
            reg = <0x10f>;
            enable-method = "psci";
            compatible = "arm,cortex-a72";
            device_type = "cpu";
        };
    };

    timer {
        interrupts = <0x1 0xd 0x4 0x1 0xe 0x4 0x1 0xb 0x4 0x1 0xa 0x4>;
        always-on;
        compatible = "arm,armv8-timer", "arm,armv7-timer";
    };

    apb-pclk {
        phandle = <0x8000>;
        clock-output-names = "clk24mhz";
        clock-frequency = <0x16e3600>;
        #clock-cells = <0x0>;
        compatible = "fixed-clock";
    };

    chosen {
        bootargs = "virtioNet(0,0)host:DeltaOS u=admin pw=123 f=0x1";
        stdout-path = "/pl011@9000000";
        devparam
        {
        };
    };
};
```
