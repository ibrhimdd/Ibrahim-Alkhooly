export default async function handler(req, res) {
  const { q } = req.query;
  const targetUrl = `https://a-rashad.gt.tc/media-api.php?q=${encodeURIComponent(q)}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        // إيهام الاستضافة المجانية بأن الطلب قادم من متصفح حقيقي لتجاوز الحماية
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const data = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: "فشل جلب البيانات من السيرفر الأصلي" });
  }
}
pp
