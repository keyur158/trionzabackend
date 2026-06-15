@echo off
echo Starting ngrok tunnel to port 3000...
start /B ngrok http 3000
timeout /t 3 >nul

for /f "tokens=*" %%a in ('curl -s http://127.0.0.1:4040/api/tunnels ^| findstr "https://"') do set RESULT=%%a
echo.
echo ========================================
echo   ngrok is running!
echo ========================================
echo.
echo   Open http://127.0.0.1:4040 to see your public URL
echo   Your webhook URL format: https://xxxx.ngrok-free.app/webhooks/shopify
echo.
echo   Go to: Shopify Admin → Settings → Notifications → Webhooks
echo   Update each webhook URL.
echo ========================================
pause