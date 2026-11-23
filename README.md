# 体感乒乓 3D

[打开网页版](https://wangzirui471-collab.github.io/pose-pingpong-3d/)。浏览器直接玩，无需登录或注册。

- 手机左下摇杆控制走位，右下选择挡球、快攻、拉球、切球和扣杀，可指定正手或反手。轮到自己发球时，右侧变为发球组合面板。
- 电脑用 WASD 走位，用空格组合球技和发球，按 V 切换视角。
- 支持自动接发球、四档难度和两位对手。使用感知台时可运行本地桥接，键盘和触屏不需要桥接。

- 测试命令为 **node tests/run.js**。
- 发布静态页可运行 **python tools/build_single.py --output index.html**。静态页面不依赖 API、登录服务或数据库。
- Three.js 和其许可证位于 vendor。人体模型改编自 MakeHuman CC0 基础网格，球体动力学参考 MIT 许可项目，许可见 third_party。

球员使用独立生成的游戏材质与手工调整的 3D 网格。男女国家队赛事照片仅作为造型参考。球衣在实战款式基础上重绘配色、纹样和国别标识。

外观参考 [王楚钦比赛照片](https://www.worldtabletennis.com/description?artId=5957)、[张本智和比赛照片](https://www.tv-tokyo.co.jp/tabletennis/news/2025/08/038711.html)和[樊振东球员肖像](https://www.butterfly-global.com/cn/sponsoring/detail/fan-zhendong.html)。握拍参考[国际乒联直板报道](https://www.ittf.com/2016/08/08/rio-2016-penhold-grip-dying-art/)。
