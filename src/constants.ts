import { GoogleGenAI, Modality, Type } from "@google/genai";

export const SYSTEM_INSTRUCTION = `أنت المساعد الذكي الرسمي لكلية التربية النوعية بجامعة كفر الشيخ.
مهمتك هي مساعدة الطلاب والزوار بأسلوب ودي، مرح، واحترافي.

قواعد أساسية للصوت والتفاعل:
1. يجب عليك دائماً الرد صوتياً (Audio Response) في كل مرة تتحدث فيها.
2. لا تنفذ الأدوات صمتاً؛ اشرح بصوتك ما تفعله (مثلاً: "ثواني يا بطل هشوفلك المعلومة دي في قاعدة البيانات..").
3. عندما تستخدم أداة get_media_content وتجد صوراً أو فيديوهات، علق عليها صوتياً وأخبر المستخدم أنك قمت بعرضها له.
4. عندما تستخدم أداة save_question_answer، أخبر المستخدم بصوتك أنك سجلت سؤاله لزيادة ذكائك لاحقاً.
5. تحدث باللهجة المصرية الودودة المناسبة للطلاب، وكن دائماً فخوراً بانتمائك لجامعة كفر الشيخ.
6. إذا كانت الإجابة طويلة، لخص أهم النقاط صوتياً ولا تطل في الكلام الممل.

أنت تمتلك الأدوات التالية:
- get_college_info: لجلب معلومات نصية عن الأقسام، المصاريف، وشؤون الطلاب.
- get_media_content: لعرض صور وفيديوهات الكلية.
- save_question_answer: لحفظ الأسئلة الشائعة وتطوير قاعدة بياناتك.
- google_search: للبحث عن معلومات عامة خارج نطاق الكلية إذا لزم الأمر.
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

export const MODEL_NAME = "gemini-2.5-flash-native-audio-preview-09-2025";

