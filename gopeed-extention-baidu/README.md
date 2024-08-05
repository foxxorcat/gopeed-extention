# Gopeed Baidu网盘下载扩展

## 声明

项目中所涉及的接口均来自百度官方，不涉及任何违法行为，本工具需要使用自己的百度网盘账号才能获取下载链接，代码全部开源，仅供学习参考；请不要将此项目用于商业用途，否则可能带来严重的后果。

## 安装

> 请确保 gopeed版本 >= `1.5.8` , 插件依赖于此版本实现的重定向控制。

打开`Gopeed`扩展页面，输入`https://github.com/foxxorcat/gopeed-extention#gopeed-extention-baidu`，点击安装即可。

## 使用说明

### 登录说明
扩展有两种登录方式，任意一种即可

#### 1. 设置 Cookie 登录
扩展需要配置网盘`Cookie`，其中必须包含`STOKEN`和`BDUSS`值，请参考以下步骤进行配置：

通过浏览器开发者工具，按`F12`打开开发者工具，切换到`Network(网络)`选项卡，找到一个以"list"开头的请求即可找到`Cookies`，从`Request Header(请求标头)`中复制完整`Cookie`值。

接着把复制的`Cookie`值填入`Gopeed`扩展的设置页面，点击保存即可。

> 注：Cookie存在有效时长，如果长时间不使用需要重新获取 

#### 2. 设置 Refresh Token 登录

目前扩展默认设置了`alist`的百度网盘参数，只需要通过此[链接](https://openapi.baidu.com/oauth/2.0/authorize?response_type=code&client_id=iYCeC9g08h5vuP9UqvPHKKSVrKFXGa1v&redirect_uri=https://alist.nn.ci/tool/baidu/callback&scope=basic,netdisk&qrcode=1)来获取你自己的`refresh_token`即可。

接着把复制的`refresh_token`值填入`Gopeed`扩展的设置页面，点击保存即可。

### 配置说明
插件默认只解析`顶层文件`，这是为了防止文件过多导致解析失败，如果需要解析更多层级的文件夹，请自行设置`最大文件深度`和`最大文件数量`限制。

### 通过链接下载

打开`Gopeed`任务页面，点击`新建任务`，创建即可解析下载。
> 注：如果有提取码，需要把提取码一起带入到分享链接中

### 链接试例
- https://pan.baidu.com/disk/main#/index?category=all
- https://pan.baidu.com/disk/main#/index?category=all&path=%2F%E6%88%91%E7%9A%84%E8%B5%84%E6%BA%90
- https://pan.baidu.com/s/1WsmMhDHLyt6e2-oPNv7TvQ?pwd=gty8
- https://pan.baidu.com/s/1WsmMhDHLyt6e2-oPNv7TvQ?pwd=gty8#list/path=%2Fsharelink1444206073-448233545468880%2F%E7%94%9F%E6%B4%BB%E5%A4%A7%E7%88%86%E7%82%B8%E7%AC%AC1%E5%AD%A3&parentPath=%2Fsharelink1444206073-448233545468880
<!-- - https://pan.baidu.com/#bdlink=YmRwYW46Ly9ZV0ZoTGpkNmZEVTJOelV5TmpJMU0zeG1ZVEppTm1NME0yWmxOak14WTJKbE9UZ3hPV1ZpT1RnMk5HSXhOV1ZpT0h3M1pqaGxOamswWkRZME5UWmxPRGxtT1RBM09ERTBOalUxWW1ZeU1UQmpNZz09CmJkcGFuOi8vWVdGaExqZDZMakF3TVh3MU1UZ3lPRFV4TVRSOE9ESmpOVFEwWlRRd05HUmhPRFJtTnpFNU4yRTVNV1V6WlRnMFpXSmxNakY4T0RRMU5qQTRNVEptTUdRMlpHRTJOMlEwTXpCaE1XSTFZVEZqWlRVMVpUVT0= --->

### 补充说明

百度网盘现在对并发数有做限制，建议下载连接数使用`4`以防止不必要的失败请求，百度网盘普通用户下载速度会比较慢，如果想要提高下载速度，请开通`SVIP`。

### 参考

百度OpenApi文档：[https://pan.baidu.com/union/doc/](https://pan.baidu.com/union/doc/)

gopeed-extension-baiduwp：[https://github.com/monkeyWie/gopeed-extension-baiduwp](https://github.com/monkeyWie/gopeed-extension-baiduwp)

baiduwp-php：[https://github.com/yuantuo666/baiduwp-php](https://github.com/yuantuo666/baiduwp-php)
