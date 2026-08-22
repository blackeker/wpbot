import { extractDramadizilerim } from './extractors/dramadizilerim.js';

(async () => {
  try {
    const res = await extractDramadizilerim('https://dramadizilerim.com/izle/gi-zli-ejderha-kralla-evli-li-k?s=1&e=3');
    console.log("SUCCESS:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("FAILED:", err.message);
  }
})();
