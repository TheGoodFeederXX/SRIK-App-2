import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { HeartHandshake, X, AlertTriangle } from 'lucide-react';

interface ChildRisk {
    student_id: string;
    student_name: string;
    message: string;
}

/** A deliberately gentle, non-technical notice for parents — no scores or
 * jargon, just a nudge to check in with the teacher. */
// Shown once in a while, not on every visit: after a parent sees (or
// dismisses) a child's note it stays hidden for a week, so when it does come
// back it reads as something to act on rather than background noise.
const QUIET_DAYS = 7;
const seenKey = (studentId: string) => `childRiskNoteSeen:${studentId}`;
const seenRecently = (studentId: string) => {
    try { const t = Number(localStorage.getItem(seenKey(studentId)) || 0); return t > 0 && Date.now() - t < QUIET_DAYS * 86_400_000; } catch { return false; }
};
const markSeen = (studentId: string) => { try { localStorage.setItem(seenKey(studentId), String(Date.now())); } catch { /* ignore */ } };

const ChildRiskBanner = () => {
    const { t } = useTranslation();
    const [flags, setFlags] = useState<ChildRisk[]>([]);
    const [dismissedIds, setDismissedIds] = useState<string[]>([]);
    // Set when the request failed, so the banner can say so rather than not appearing.
    const [failed, setFailed] = useState(false);
    // Once the parent has acknowledged the failure, stop showing it.
    const [notedFailure, setNotedFailure] = useState(false);

    const fetchFlags = useCallback(async () => {
        try {
            const data = await api.getMyChildrenRisk();
            const list: ChildRisk[] = (Array.isArray(data) ? data : []).filter((f: ChildRisk) => f && f.student_id && !seenRecently(f.student_id));
            setFlags(list);
            list.forEach(f => markSeen(f.student_id));
            setFailed(false);
        } catch (err) {
            // THE FAILURE MUST BE VISIBLE, BECAUSE SILENCE HERE IS A CLAIM.
            //
            // This banner is the only place a parent is told that a teacher has
            // raised a concern about their child. When the request failed, the banner
            // simply did not render — and "no banner" reads exactly like "no concern
            // has been raised". A parent would be reassured by a request that never
            // arrived. So a failure now says so, and says what it does NOT mean.
            console.error('Error fetching child risk notices:', err);
            setFailed(true);
        }
    }, []);

    useEffect(() => { fetchFlags(); }, [fetchFlags]);

    const visible = flags.filter(f => !dismissedIds.includes(f.student_id));

    if (failed && !notedFailure) {
        return (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <p className="font-bold text-amber-900">{t('childRiskBanner.weCouldNotCheckTheNotesAboutYourChild')}</p>
                    <p className="text-sm text-amber-700 mt-0.5">{t('childRiskBanner.thisDoesNotMeanThereIsNothingToKnow')}</p>
                </div>
                <button onClick={() => setNotedFailure(true)}
                    className="p-1 text-amber-400 hover:text-amber-600 flex-shrink-0" aria-label={t('childRiskBanner.dismiss')}>
                    <X className="w-4 h-4" />
                </button>
            </div>
        );
    }

    if (visible.length === 0) return null;

    return (
        <div className="space-y-3">
            {visible.map(f => (
                <div key={f.student_id} className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                    <HeartHandshake className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="font-bold text-amber-900">A Note About {f.student_name}</p>
                        <p className="text-sm text-amber-700 mt-0.5">{f.message}</p>
                    </div>
                    <button onClick={() => { markSeen(f.student_id); setDismissedIds(d => [...d, f.student_id]); }}
                        className="p-1 text-amber-400 hover:text-amber-600 flex-shrink-0" aria-label={t('childRiskBanner.dismiss')}>
                        <X className="w-4 h-4" />
                    </button>
                </div>
            ))}
        </div>
    );
};

export default ChildRiskBanner;
