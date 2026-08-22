# Yes Weigh · Wan Hai Live Track (Chrome)

Wan Hai only. Flow:

1. In Yes Weigh, open a PO with shipping line **Wan Hai** and press **Live track**
2. Chrome opens Wan Hai; pass the CAPTCHA (“I am human”)
3. The extension selects **Ctnr No.**, pastes the container, clicks **Query**
4. On the results page it reads status / vessel / voyage and sends them back to Yes Weigh → Firestore

## Install (Chrome / Edge)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → choose this folder: `extensions/wanhai-live-track`
4. Keep Yes Weigh and Wan Hai tabs in the same browser profile

## Notes

- The website still requires **you** to solve CAPTCHA (Imperva). Automation starts only after that.
- Reload the Yes Weigh tab once after installing the extension.
- If Query UI markup changes, update `content-wanhai.js` selectors.
