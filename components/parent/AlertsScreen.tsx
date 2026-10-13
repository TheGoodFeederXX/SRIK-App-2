import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../../src/lib/branding';
import {
    listAnnouncements,
    AUDIENCE_LABELS,
    type Announcement,
} from '../../src/lib/supabase/announcements';

/**
 * SCHOOL NOTICES, for a parent.
 *
 * WHAT THIS SCREEN USED TO BE. It was a feed of "notifications" with unread dots, a
 * live socket feed, and a shared cache — built on a notification system this school
 * does not have. There is no `notifications` table. Every fetch went to a server that
 * is not deployed, so a parent opening this screen saw "No new notifications" whether
 * the school had sent ten notices or none.
 *
 * WHAT IT IS NOW. The school's PUBLISHED announcements, which a guardian can actually
 * read: the policy admits a parent because they are the audience, not because of a
 * permission. No unread state, because there is no per-parent read tracking and
 * inventing one would mean a dot that reappears on every device.
 *
 * The audience is shown, so a parent can tell an all-school notice from one meant only
 * for families.
 */
interface AlertsScreenProps {
    navigateTo: (view: string, title: string, props?: any) => void;
}

const AlertsScreen: React.FC<AlertsScreenProps> = () => {
    const { t } = useTranslation();
    const [notices, setNotices] = useState<Announcement[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const all = await listAnnouncements();
                if (!active) return;
                // PUBLISHED only, and the database already refuses a STAFF notice to a
                // guardian. A draft is the office still writing; a withdrawn notice was
                // taken back, and showing either to a parent would be showing them
                // something the school did not send.
                setNotices(all.filter(a => a.status === 'PUBLISHED'));
            } catch (e) {
                if (active) setError(e instanceof Error ? e.message : 'Could not load notices.');
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, []);

    if (loading) return <div className="p-8 text-center text-gray-500">Loading notices...</div>;
    if (error) return <div className="p-8 text-center text-red-600">{error}</div>;

    return (
        <div className="flex flex-col h-full bg-gray-100">
            <main className="flex-grow p-4 space-y-3 overflow-y-auto pb-24">
                {notices.length > 0 ? (
                    notices.map((notice, i) => (
                        <motion.div
                            key={notice.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25, delay: Math.min(i, 10) * 0.05 }}
                            className="w-full text-left bg-white rounded-xl shadow-sm p-4"
                        >
                            <div className="flex justify-between items-start gap-3">
                                <p className="font-bold text-gray-900">{notice.title}</p>
                                <span className="text-xs text-gray-500 flex-shrink-0">
                                    {formatDateTime(notice.publish_at ?? notice.created_at)}
                                </span>
                            </div>
                            <p className="text-sm mt-2 text-gray-800 whitespace-pre-wrap">{notice.body}</p>
                            <p className="text-xs mt-3 text-gray-500">
                                {t(AUDIENCE_LABELS[notice.audience])}
                            </p>
                        </motion.div>
                    ))
                ) : (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2 }}
                        className="text-center py-10 bg-white rounded-2xl border border-dashed border-gray-200"
                    >
                        <p className="text-gray-500">The school has not sent any notices yet.</p>
                    </motion.div>
                )}
            </main>
        </div>
    );
};

export default AlertsScreen;
