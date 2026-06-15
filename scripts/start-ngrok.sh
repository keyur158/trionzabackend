#!/bin/bash
echo "Starting ngrok tunnel to port 3000..."
ngrok http 3000 &
sleep 3

NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | grep -o '"public_url":"https://[^"]*' | grep -o 'https://.*')

echo ""
echo "========================================"
echo "  ngrok is running!"
echo "========================================"
echo ""
echo "  Your public URL: $NGROK_URL"
echo ""
echo "  Webhook URL (copy this to Shopify):"
echo "  ${NGROK_URL}/webhooks/shopify"
echo ""
echo "  Go to: Shopify Admin → Settings → Notifications → Webhooks"
echo "  Edit each webhook URL to the above."
echo ""
echo "  ngrok dashboard: http://127.0.0.1:4040"
echo "========================================"
echo ""
echo "Press Ctrl+C to stop ngrok"
wait