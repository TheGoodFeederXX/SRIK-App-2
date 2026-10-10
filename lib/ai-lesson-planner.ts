/**
 * AI Lesson Planner Service
 * Generates structured lesson plans aligned with the KSSR curriculum.
 */

import { getAIClient } from './ai';
import { api } from './api';

export interface LessonPlan {
    topic: string;
    objectives: string[];
    materials: string[];
    activities: string[];
    evaluation: string[];
    resources_local?: string[]; // Suggests locally available materials
}

/**
 * Generates a full lesson plan using Gemini.
 */
export async function generateLessonPlan(
    subject: string,
    topic: string,
    gradeLevel: string
): Promise<LessonPlan | null> {
    const ai = getAIClient();

    // The prompt names the curriculum and where the teaching aids come from. It
    // used to name the NIGERIAN national curriculum and Nigeria, so the model
    // returned objectives from the wrong syllabus and suggested items bought in
    // another country; this school follows KSSR and its staff buy in Malaysia.
    const systemPrompt = `You are an expert curriculum designer for Malaysian primary education.
    Generate a lesson plan following the structure:
    {
      "topic": "string",
      "objectives": ["list"],
      "materials": ["list"],
      "activities": ["Introduction, Development, Conclusion"],
      "evaluation": ["questions"],
      "resources_local": ["suggest locally available teaching aids found in Malaysia, e.g., bottle caps for counting"]
    }
    Align strictly with KSSR (Kurikulum Standard Sekolah Rendah) standards for ${gradeLevel}.`;

    const prompt = `Subject: ${subject}\nTopic: ${topic}\nGrade: ${gradeLevel}`;

    try {
        const result = await ai.generateContent({
            contents: prompt,
            generationConfig: { responseMimeType: "application/json" },
            systemInstruction: { parts: [{ text: systemPrompt }] }
        });

        const plan: LessonPlan = JSON.parse(result.text);

        // Optional: Save to DB
        // await api.from('lesson_plans').insert({ ...plan, subject, grade_level: gradeLevel });

        return plan;
    } catch (error) {
        console.error('âŒ AI Lesson Planning failed:', error);
        return null;
    }
}

