export default async function handler(req, res) {
    const { q } = req.query;
    const targetUrl = `https://a-rashad.gt.tc/media-api.php?q=${encodeURIComponent(q)}`;

    try {
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                // هذا السطر ضروري جداً لتجاوز حماية الـ Bot في الاستضافات المجانية
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        });

        // قراءة الرد كنص أولاً للتأكد من نوعه قبل تحويله لـ JSON
        const text = await response.text();
        
        try {
            const data = JSON.parse(text);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.status(200).json(data);
        } catch (e) {
            // إذا فشل التحويل، فهذا يعني أن السيرفر أرسل HTML (صفحة حماية)
            res.status(500).json({ error: "Server returned HTML instead of JSON", preview: text.substring(0, 100) });
        }
    } catch (error) {
        res.status(500).json({ error: "Failed to connect to backend host" });
    }
}
