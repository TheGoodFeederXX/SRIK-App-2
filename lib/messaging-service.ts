import { api } from './api';
import { getAIClient } from './ai';

export class MessagingService {
    /**
     * Sends a message with office-hours check and urgent flag.
     */
    static async sendMessage(payload: {
        receiver_id: string,
        content: string,
        is_urgent?: boolean,
        school_id: string
    }) {
        const { data: { user } } = await api.auth.getUser();
        if (!user) throw new Error('Unauthorized');

        // 1. Check Office Hours if receiver is a teacher
        const { data: receiver } = await api
            .from('profiles')
            .select('role, full_name')
            .eq('id', payload.receiver_id)
            .maybeSingle();

        let autoReplySent = false;
        if (receiver?.role === 'teacher') {
            const isInside = await this.isWithinOfficeHours(payload.receiver_id);
            if (!isInside) {
                // We still send the message, but mark that an auto-reply should fire
                autoReplySent = true;
            }
        }

        // 2. Insert Message
        const { data: msg, error } = await api
            .from('messages')
            .insert({
                sender_id: user.id,
                receiver_id: payload.receiver_id,
                content: payload.content,
                is_urgent: payload.is_urgent || false,
                school_id: payload.school_id,
                auto_reply_sent: autoReplySent
            });

        if (error) throw error;

        // 3. Trigger Admin notification for Urgent messages
        if (payload.is_urgent) {
            await this.notifyAdminOfUrgentMessage(msg.id, payload.school_id);
        }

        return { msg, autoReplySent };
    }

    private static async isWithinOfficeHours(teacherId: string): Promise<boolean> {
        const now = new Date();
        const day = now.getDay();
        const time = now.toTimeString().split(' ')[0]; // HH:MM:SS

        const { data: hours } = await api
            .from('teacher_office_hours')
            .select('*')
            .eq('teacher_id', teacherId)
            .eq('day_of_week', day)
            .maybeSingle();

        if (!hours) return true; // Default to always available if not set

        return time >= hours.start_time && time <= hours.end_time;
    }

    /**
     * Detects non-Malay text and suggests a Malay translation.
     *
     * The detector looked for Yoruba, Igbo and Hausa — languages of the country
     * this app was first built for. At a Malaysian school the useful check is
     * the reverse: flag anything that is not in Malay so it can be translated.
     */
    static async getTranslationSuggestion(content: string) {
        const ai = getAIClient();
        const prompt = `Identify if the following text is NOT in Malay (Bahasa Melayu).
        If it is not in Malay, translate it to Malay. If it is already in Malay, return "null".
        Text: "${content}"`;

        try {
            const result = await ai.generateContent(prompt);
            const text = result.text;
            return text.toLowerCase().includes('null') ? null : text;
        } catch {
            return null;
        }
    }

    private static async notifyAdminOfUrgentMessage(msgId: string, schoolId: string) {
        // Implementation for admin alert logic
    }
}

