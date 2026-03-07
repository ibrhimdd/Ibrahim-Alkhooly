// api/proxy.js
export default async function handler(req, res) {
  const { q } = req.query;
  const targetUrl = `https://a-rashad.gt.tc/media-api.php?q=${encodeURIComponent(q)}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        // محاكاة متصفح حقيقي لتجاوز حماية الاستضافة المجانية
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const data = await response.json();
    
    // إرسال البيانات مع السماح بـ CORS من سيرفر Vercel نفسه
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch from backend" });
  }
}
