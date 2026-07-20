# YT Summarizer Bot — Chrome Extension

Robot icon pe click karo, jo bhi YouTube video khula ho uska **free, fully
local** summary mil jayega — koi API key nahi, koi server nahi.

## Kaise kaam karta hai (Laravel se comparison)

| Chrome Extension file | Laravel mein iske jaisa |
|---|---|
| `manifest.json` | `config/app.php` + `routes/web.php` (define karta hai kya-kaha chalega) |
| `background.js` | Controller — request (icon click) leta hai, kaam route karta hai |
| `content.js` | Blade view + thoda JS — jo user ko YouTube page pe dikhta hai |
| `offscreen.js` | Ek "job/worker" jo heavy kaam (AI model) background mein karta hai |
| `content.css` | Aapki Tailwind styling — yahan plain CSS hai lekin Tailwind naming ki tarah comments likhe hain |

Koi PHP/Laravel backend yahan nahi hai — poora kaam browser ke andar hota hai.
Isi wajah se ye 100% free hai (Hugging Face ka model directly browser mein
chalta hai, `Xenova/all-MiniLM-L6-v2` naam ka embedding model).

## Ye AI technique kya karti hai (important — samajh lena)

Ye **generative AI nahi hai** (jaise Claude/ChatGPT naya text likhte hain).
Embedding models sirf sentences ko numbers (vectors) mein badalte hain, naya
text nahi likh sakte. Isliye is bot ne "extractive summarization" use ki hai:

1. Transcript ke sentences alag karta hai
2. Har sentence ka embedding (vector) nikalta hai
3. Sabse "central"/representative sentences dhoondta hai (jo poore video ke
   topic ko best represent karte hain)
4. Wahi top sentences — jaisa video mein bole gaye the, waise hi — summary
   ke taur pe dikhata hai

**Matlab:** summary transcript ki ASLI lines hongi (thoda select karke), na
ke naya likha hua paragraph. Aur ye video ki jo bhi language ho (English,
Urdu, etc — jo bhi caption available ho), summary usi language mein hogi;
translate nahi karega. Agar aapko naya-likha / translated summary chahiye,
to us ke liye ek LLM (Claude API) chahiye hoga — jo pehle wale terminal
script mein tha.

## Install kaise karein (unpacked extension)

1. Chrome mein jao: `chrome://extensions`
2. Top-right "Developer mode" ON karo
3. "Load unpacked" click karo
4. Ye poora `yt-summarizer-extension` folder select karo
5. Toolbar mein robot icon show ho jayega 🤖

## Use kaise karein

1. Koi YouTube video khol lo (`youtube.com/watch?v=...`)
2. Toolbar mein robot icon pe click karo
3. Bottom-right corner mein panel khulega:
   - Pehle transcript nikalega
   - Phir AI model download hoga (**sirf pehli baar** — 30MB, phir cache ho
     jayega, next time turant chalega)
   - Phir summary dikhayega

## Limitations (important)

- Sirf un videos pe kaam karega jinke **captions/transcript available** hon
  (khud video creator ke ya auto-generated). Agar captions band hain, bot
  bata dega ke summarize nahi ho sakta.
- Pehli baar model download hone mein internet chahiye + thoda time lagega.
- Ye extractive hai, translate nahi karta (upar wali explanation dekho).

## Files

```
yt-summarizer-extension/
├── manifest.json      # extension config
├── background.js      # icon click handle karta hai, kaam route karta hai
├── content.js          # YouTube page pe transcript nikalta hai + UI dikhata hai
├── content.css          # panel ki styling
├── offscreen.html/.js   # Hugging Face model yahan chalta hai
└── icons/                # robot icon (16/48/128px)
```
