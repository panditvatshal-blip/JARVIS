# Jarvis: वॉइस असिस्टेंट (फ़ुल-स्टैक)

Node.js + Express + SQLite + JWT लॉगिन + Claude API + वेब UI + PC agent (Python)

## लोकल चलाना
    npm install
    cp .env.example .env      # JWT_SECRET भरो (ANTHROPIC_API_KEY वैकल्पिक)
    npm run dev               # http://localhost:3000

## लाइव करना (Render, मुफ़्त)
1. प्रोजेक्ट GitHub पर पुश करो।
2. render.com > New > Web Service > अपना repo चुनो।
3. Build Command: `npm install`  |  Start Command: `npm start`
4. Environment: `JWT_SECRET` (लंबा random), `ANTHROPIC_API_KEY` (वैकल्पिक), `NODE_VERSION` = `20`
5. Deploy दबाओ। तुम्हें `https://नाम.onrender.com` मिलेगा। HTTPS होने से माइक चलेगा।

## PC कंट्रोल
अपने PC पर: `pip install websockets pyautogui` फिर `python agent.py`। जो token छपे उसे Chrome में लाइव साइट के "PC एजेंट" बॉक्स में डालो।

## ध्यान रखो
- मुफ़्त Render 15 मिनट idle रहने पर सो जाता है (पहली बार खुलने में ~1 मिनट)।
- मुफ़्त Render पर SQLite का डेटा हर redeploy/restart पर मिट सकता है। असली स्टोरेज चाहिए तो Render persistent disk या Postgres/MongoDB Atlas लगाओ।
