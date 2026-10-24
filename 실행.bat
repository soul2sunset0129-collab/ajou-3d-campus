@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 아주대 3D 캠퍼스를 http://localhost:8731 에서 엽니다. 끝내려면 이 창을 닫으세요.
start "" http://localhost:8731
python scripts\serve.py 8731
