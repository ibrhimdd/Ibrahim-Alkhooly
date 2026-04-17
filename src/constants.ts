import { GoogleGenAI, Modality, Type } from "@google/genai";

export const SYSTEM_INSTRUCTION = `
# الهوية والشخصية (الروح المرحة)
- أنت "المساعد الذكي لتربية نوعية كفر الشيخ"، صاحب الطلاب وأخوهم الكبير.
- كلامك كله "عامية مصرية" فرفوشة، استعمل إيموجيز (Emojis) وحسس الطالب إنه في بيته (مثلاً: "يا دكتور"، "نورت الكلية يا بطل").
- ممنوع تماماً الفصحى أو الأسلوب الروبوتي الجاف.

# بروتوكول استرجاع المعلومات (بالترتيب)
1. فتش الأول في "get_cached_answer".
2. لو مفيش، شوف في "get_college_info".
3. لو مفيش، ابحث في موقع الكلية (site:kfs.edu.eg/spe/) باستخدام "googleSearch".
4. آخر حاجة البحث العام، وقول في الآخر: "المعلومة دي من الإنترنت يا صاحبي، ياريت تتأكد من الكلية برضه".

# القواعد الصارمة للوسائط (الصور والفيديو)
- لما المستخدم يطلب يشوف حاجة، استدعي "get_media_content".
- **قاعدة ذهبية:** لازم تعرض "نتيجة واحدة فقط" (صورة واحدة أو فيديو واحد) تكون هي الأدق والأقرب لطلب المستخدم. ممنوع تعرض أكتر من نتيجة لنفس الطلب.
- عند العرض قول: "ده توضيح مرئي لـ [اسم الحاجة]".

# القواعد العامة
- بعد كل إجابة جديدة، استدعي "save_question_answer" عشان تحفظها في الإحصائيات.
- جاوب علطول، بلاش مقدمات زي "بناءً على البيانات".
`;

export const GET_MEDIA_CONTENT_TOOL = {
  name: "get_media_content",
  parameters: {
    type: Type.OBJECT,
    description: "استرجاع رابط وسائط واحد فقط (الأكثر دقة) من قاعدة البيانات.",
    properties: {
      query: {
        type: Type.STRING,
        description: "موضوع البحث عن الوسائط (مثلاً: صور مدرج 1).",
      },
    },
    required: ["query"],
  },
};

export const GET_COLLEGE_INFO_TOOL = {
  name: "get_college_info",
  parameters: {
    type: Type.OBJECT,
    description: "الحصول على معلومات نصية مفصلة من قاعدة بيانات الكلية.",
    properties: {
      query: {
        type: Type.STRING,
        description: "كلمات البحث (مثلاً: شؤون الطلاب، الأقسام).",
      },
    },
    required: ["query"],
  },
};

export const GET_CACHED_ANSWER_TOOL = {
  name: "get_cached_answer",
  parameters: {
    type: Type.OBJECT,
    description: "البحث في الأسئلة الشائعة اللي اتسألت قبل كده.",
    properties: {
      question: {
        type: Type.STRING,
        description: "سؤال المستخدم.",
      },
    },
    required: ["question"],
  },
};

export const SAVE_QUESTION_ANSWER_TOOL = {
  name: "save_question_answer",
  parameters: {
    type: Type.OBJECT,
    description: "حفظ السؤال وإجابته للتطوير المستمر.",
    properties: {
      question: { type: Type.STRING },
      answer: { type: Type.STRING },
    },
    required: ["question", "answer"],
  },
};

export const MODEL_NAME = "gemini-2.5-flash-native-audio-preview-09-2025";
