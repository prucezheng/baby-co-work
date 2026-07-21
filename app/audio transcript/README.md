# Ark Audio Transcriber

一个极简工具：输入一个本地视频或音频文件，抽取音频，上传到火山方舟 Ark，然后只返回音频全文转写。

它不解析抖音链接，不分析画面，不总结内容，不生成育儿建议。

## 前置依赖

工具本身只使用 Python 标准库。运行时需要：

- `ffmpeg`：从本地视频中提取并压缩音频

如果输入已经是小于 25 MB 的 `mp3` 或 `wav`，可以不经过转码；输入视频时必须有 `ffmpeg`。

macOS:

```bash
brew install ffmpeg
```

## 配置

不要把 API Key 写进源码。使用环境变量：

```bash
export ARK_API_KEY="你的火山方舟 API Key"
```

可选环境变量：

```bash
export ARK_MODEL="doubao-seed-2-0-lite-260428"
export ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
```

## 使用

```bash
cd "app/audio transcript"
python3 -m ark_audio_transcriber "/path/to/video.mp4"
```

安装为命令：

```bash
cd "app/audio transcript"
python3 -m pip install -e .
ark-audio-transcribe "/path/to/video.mp4"
```

输出只有转写全文。失败时进程返回非 0，并在 stderr 输出明确错误。

## Agent 调用建议

任何 Agent 只需要传入本地文件路径，并读取标准输出：

```bash
ark-audio-transcribe "$LOCAL_VIDEO_PATH"
```
