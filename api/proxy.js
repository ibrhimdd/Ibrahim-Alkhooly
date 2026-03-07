export default async function handler(req, res) {
  const { q } = req.query;
  // رابط ملف الـ PHP الخاص بك على الاستضافة
  const targetUrl = `https://a-rashad.gt.tc/media-api.php?q=${encodeURIComponent(q)}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        // إيهام السيرفر بأن الطلب قادم من متصفح حقيقي لتجاوز الحماية
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    
    const data = await response.json();
    
    // إرسال البيانات مع تفعيل CORS من سيرفر Vercel نفسه
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (error) {
    // في حال أرجع السيرفر HTML بدلاً من JSON، سيظهر الخطأ هنا
    res.status(500).json({ error: "الاستضافة لا تزال تحظر الطلب، تأكد من ملف الـ PHP" });
  }
}
