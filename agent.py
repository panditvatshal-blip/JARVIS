"""Jarvis PC agent.
Setup:  pip install websockets pyautogui
Run:    python agent.py   (copy the TOKEN it prints into the web page)
"""
import asyncio, json, os, platform, secrets, subprocess
import pyautogui
import websockets

TOKEN = secrets.token_urlsafe(8)
OS = platform.system()

# Only these apps can be opened (safety whitelist)
APPS = {
    "notepad":    {"Windows": "notepad", "Darwin": "TextEdit", "Linux": "gedit"},
    "calculator": {"Windows": "calc", "Darwin": "Calculator", "Linux": "gnome-calculator"},
    "chrome":     {"Windows": "chrome", "Darwin": "Google Chrome", "Linux": "google-chrome"},
    "vscode":     {"Windows": "code", "Darwin": "Visual Studio Code", "Linux": "code"},
}


def open_app(name):
    cmd = APPS.get(name, {}).get(OS)
    if not cmd:
        return "यह ऐप whitelist में नहीं है।"
    if OS == "Windows":
        subprocess.Popen(f"start {cmd}", shell=True)
    elif OS == "Darwin":
        subprocess.Popen(["open", "-a", cmd])
    else:
        subprocess.Popen([cmd])
    return f"{name} खोल दिया।"


def volume(direction):
    key = {"up": "volumeup", "down": "volumedown", "mute": "volumemute"}.get(direction)
    if not key:
        return "अमान्य वॉल्यूम कमांड।"
    for _ in range(5 if direction != "mute" else 1):
        pyautogui.press(key)
    return "वॉल्यूम बदल दिया।"


def screenshot():
    path = os.path.expanduser("~/jarvis_screenshot.png")
    pyautogui.screenshot(path)
    return f"स्क्रीनशॉट सेव हुआ: {path}"


async def handler(ws):
    try:
        auth = json.loads(await ws.recv())
        ok = secrets.compare_digest(str(auth.get("token", "")), TOKEN)
        await ws.send(json.dumps({"hello": True, "ok": ok}))
        if not ok:
            return
        async for raw in ws:
            c = json.loads(raw)
            a = c.get("action")
            if a == "open_app":
                msg = open_app(c.get("name", ""))
            elif a == "volume":
                msg = volume(c.get("dir", ""))
            elif a == "screenshot":
                msg = screenshot()
            else:
                msg = "अज्ञात कमांड।"
            await ws.send(json.dumps({"msg": msg}))
    except websockets.ConnectionClosed:
        pass


async def main():
    print("TOKEN:", TOKEN)
    async with websockets.serve(handler, "127.0.0.1", 8765):
        await asyncio.Future()


asyncio.run(main())
