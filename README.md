# 体感乒乓 3D

[打开网页版](https://wangzirui471-collab.github.io/pose-pingpong-3d/)。浏览器直接玩，无需登录或注册。

- 手机左下摇杆控制走位，右下选择挡球、快攻、拉球、切球和扣杀，可指定正手或反手。轮到自己发球时，右侧变为发球组合面板。
- 右上的持拍按钮可切换左右手，也可以在设置中直接选择。刷新保留选择。
- 电脑用 WASD 走位，用空格组合球技和发球，按 V 切换视角。
- 支持自动接发球和四档难度。可操控樊振东、马龙，挑战王楚钦、张本智和、奥恰洛夫、孙颖莎。使用感知台时可运行本地桥接，键盘和触屏不需要桥接。

- 测试命令为 **node tests/run.js** 和 **node tests/forehand.js**。
- 发布静态页可运行 **python tools/build_single.py --output index.html**。静态页面不依赖 API、登录服务或数据库。
- Three.js 和其许可证位于 vendor。人体模型改编自 MakeHuman CC0 基础网格，球体动力学参考 MIT 许可项目，许可见 third_party。

球员使用独立制作的游戏材质与手工调整的 3D 网格。马龙、孙颖莎和奥恰洛夫的头部、发型和球衣参照实拍视频中的多角度画面制作。球鞋按可见轮廓和配色重制。公开片段用于人工形态和动作参考，没有进行同步多机位扫描。

王楚钦、张本智和、樊振东的轮廓及服装按比赛视频重新校准，面部保留原有美术材质。樊振东保留游戏设定的直板玩法。握拍参考 [国际乒联直板报道](https://www.ittf.com/2016/08/08/rio-2016-penhold-grip-dying-art/)。


## 训练与比赛视频参考

- 马龙的准备姿态和正手引拍参考全运会训练，比赛服参考 2024 年澳门世界杯转播。[全运会训练](https://tv.cctv.com/2017/08/25/VIDEhnuMh74u7HqUsaCqjawu170825.shtml) · [澳门世界杯](https://tv.cctv.com/2024/04/22/VIDET2NxogXjUYSKj2lo7dJQ240422.shtml)
- 孙颖莎的低重心、短发与蓝色比赛服参考热身训练和北京女单决赛的多个角度。[训练](https://tv.cctv.com/2025/02/24/VIDEKWdviZJdDvJjngOI0DKP250224.shtml) · [中国大满贯女单决赛](https://tv.cctv.com/2024/10/07/VIDEH74QhD8OBZdxUAxyMWQI241007.shtml)
- 奥恰洛夫的侧脸、短发、站姿与蓝金比赛服参考新乡总决赛和欧洲大满贯画面。[新乡总决赛](https://tv.cctv.com/2022/10/28/VIDEfxY6oIrABwwT52XEISKf221028.shtml) · [欧洲大满贯](https://tv.cctv.com/2026/08/12/VIDEWYn0c2RcK0bPF0w5odqh260812.shtml)
- 正手动画将肩髋转动、屈肘、触球与随挥串联。真实体感模式仍使用校准后的拍面方向。[Table Tennis England 正手训练](https://newsarchive.tabletennisengland.co.uk/news/archived/developing-forehand-strokes/)
- 王楚钦、张本智和的发型和比赛服参考横滨决赛。樊振东的体态参考重庆冠军赛，黑金比赛服参考新乡总决赛。[横滨决赛](https://tv.cctv.com/2025/08/11/VIDEvAtZPyBS4aovVdSHaqoL250811.shtml) · [重庆冠军赛决赛](https://tv.cctv.com/2024/06/03/VIDEqv9vJQ4Kki2Zp2gAIhTi240603.shtml) · [新乡总决赛](https://tv.cctv.com/2022/10/28/VIDEfxY6oIrABwwT52XEISKf221028.shtml)
