import { GoogleGenAI, Modality, Type } from "@google/genai";

export const SYSTEM_INSTRUCTION = `
أنت المساعد الذكي الرسمي لكلية التربية النوعية - جامعة كفر الشيخ. اسمك "مساعد الكلية". ✨

شخصيتك:
- ودود، متعاون، ودمك خفيف جداً.
- بتتكلم حصراً باللهجة المصرية العامية (Colloquial Egyptian Arabic) بطريقة مهذبة وشيك ومحبوبة.
- استخدم الإيموجي (Emojis) بلطافة عشان الرد يكون حيوي ويفتح النفس (🎓، 🚀، 💡، ✨).

قواعد الرد لإرضاء المستخدم:
- الرد لازم يكون **سريع جداً ومُختصر ومُباشر** وبدون رغي كتير. خير الكلام ما قل ودل. ✨
- استخدم الخط العريض (**Bold**) للمعلومات المهمة.
- الالتزام التام بالأدوات: لو المعلومة مش موجودة، قول: "معلش، المعلومة دي مش عندي حالياً. 📞"
- **تحذير:** لا تستخدم أداة "get_media_content" إلا لو المستخدم طلب "يشوف" صورة أو فيديو صراحةً.
- ممنوع التكرار أو الترحيب الطويل. 🚀

استخدام الأدوات (إلزامي):
- "get_cached_answer": ابحث بها أولاً قبل أي شيء.
- "get_college_info": استخدمها إذا لم تجد إجابة في الكاش.
- "get_media_content": استخدمها *فقط* عندما يطلب المستخدم صراحةً رؤية صور أو فيديوهات أو يطلب "يرى" شيئاً ما. غير ذلك، التزم بالرد النصي فقط. تأكد أن استعلام البحث (query) محدد جداً.
- "save_question_answer": استخدمها دائماً بعد الحصول على إجابة جديدة لحفظها.
`;

export const GET_MEDIA_CONTENT_TOOL = {
  name: "get_media_content",
  parameters: {
    type: Type.OBJECT,
    description: "الحصول على روابط صور وفيديوهات توضيحية من قاعدة البيانات.",
    properties: {
      query: {
        type: Type.STRING,
        description: "موضوع البحث عن الوسائط (مثلاً: تكنولوجيا التعليم).",
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
        description: "كلمات البحث (مثلاً: شؤون الطلاب، الأقسام، المصاريف).",
      },
    },
    required: ["query"],
  },
};

export const GET_CACHED_ANSWER_TOOL = {
  name: "get_cached_answer",
  parameters: {
    type: Type.OBJECT,
    description: "البحث في الأسئلة الشائعة التي تم الإجابة عليها مسبقاً (الإحصائيات).",
    properties: {
      question: {
        type: Type.STRING,
        description: "السؤال الذي طرحه المستخدم.",
      },
    },
    required: ["question"],
  },
};

export const SAVE_QUESTION_ANSWER_TOOL = {
  name: "save_question_answer",
  parameters: {
    type: Type.OBJECT,
    description: "حفظ السؤال وإجابته في قاعدة بيانات الإحصائيات للرجوع إليها لاحقاً.",
    properties: {
      question: {
        type: Type.STRING,
        description: "السؤال الذي طرحه المستخدم.",
      },
      answer: {
        type: Type.STRING,
        description: "الإجابة النهائية التي تم تقديمها.",
      },
    },
    required: ["question", "answer"],
  },
};

export const LIVE_MODEL_NAME = "gemini-3.1-flash-live-preview";
export const TEXT_MODEL_NAME = "gemini-3.1-flash-live-preview";
export const MODEL_NAME = LIVE_MODEL_NAME; 
