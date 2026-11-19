# Jarvis: वॉइस असिस्टेंट (फ़ुल-स्टैक)

Node.js + Express + SQLite + JWT लॉगिन + Claude API + वेब UI + PC agent (Python)

## लोकल चलाना
    npm install
    cp .env.example .env      # JWT_SECRET भरो (ANTHROPIC_API_KEY वैकल्पिक)
    npm run dev               # http://localhost:3000

## लाइव करना (Render)
1. इस corrected project को GitHub पर push करो।
2. Render में **New > Blueprint** चुनकर repository connect करो। `render.yaml` service, Node version और securely generated `JWT_SECRET` configure करेगा; deploy शुरू करो।
3. वैकल्पिक रूप से **New > Web Service** में Build Command `npm install` और Start Command `npm start` रखो। Environment में `JWT_SECRET` को Render के secret generator से सेट करो; `ANTHROPIC_API_KEY` वैकल्पिक है।
4. Deploy के बाद `https://<service-name>.onrender.com/` खोलो। Root URL सीधे `public/index.html` देता है। उसी पेज से signup/login करके dashboard खुलता है।

## Routes
- `GET /` — frontend entry point (login/signup और dashboard इसी single page में हैं)
- `POST /api/signup`, `POST /api/login` — account creation and login
- `GET /api/me` — restore a signed-in session
- `PUT /api/devices`, `POST /api/chat` — dashboard actions

Render का ephemeral filesystem redeploy/restart पर SQLite database मिटा सकता है। स्थायी user/device data के लिए persistent disk जोड़ें और `DB_PATH` को disk mount path पर रखें।

## PC कंट्रोल
अपने PC पर: `pip install websockets pyautogui` फिर `python agent.py`। जो token छपे उसे Chrome में लाइव साइट के "PC एजेंट" बॉक्स में डालो।

## ध्यान रखो
- मुफ़्त Render 15 मिनट idle रहने पर सो जाता है (पहली बार खुलने में ~1 मिनट)।
- मुफ़्त Render पर SQLite का डेटा हर redeploy/restart पर मिट सकता है। असली स्टोरेज चाहिए तो Render persistent disk या Postgres/MongoDB Atlas लगाओ।
