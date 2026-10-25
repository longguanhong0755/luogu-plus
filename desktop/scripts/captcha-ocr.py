# 仅测试/可选功能用：ddddocr 识别验证码。
# 用法：python captcha-ocr.py <图片路径> [--std]
# 默认 beta 模型（实测对洛谷验证码明显更准），--std 切回标准模型。
# 输出：stdout 第一行为识别文本；无法识别时以 ERR 开头并退出码非 0。
import sys


def main():
    if len(sys.argv) < 2:
        print("ERR no-image")
        return 2
    try:
        import ddddocr
    except Exception as exc:  # 未安装 ddddocr / 依赖缺失
        print("ERR import:" + str(exc).replace("\n", " ")[:200])
        return 2
    try:
        with open(sys.argv[1], "rb") as handle:
            image = handle.read()
        ocr = ddddocr.DdddOcr(show_ad=False, beta="--std" not in sys.argv)
        text = ocr.classification(image)
        if isinstance(text, bytes):
            text = text.decode("utf-8", "replace")
        print(str(text).strip())
        return 0
    except Exception as exc:
        print("ERR ocr:" + str(exc).replace("\n", " ")[:200])
        return 1


if __name__ == "__main__":
    sys.exit(main())
