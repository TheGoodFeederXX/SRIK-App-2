import React from 'react';
import { useTranslation } from 'react-i18next';

interface ComingSoonScreenProps {
    /** What the teacher came here for, in their own words. */
    title: string;
    /**
     * Why it is not ready, said plainly. Not "an error occurred" — the person
     * reading this is a teacher, and "this part is not built yet" is a complete
     * and honest answer.
     *
     * A CALLER MAY PASS A TRANSLATION KEY INSTEAD. The 204 screens that use this
     * component each hold a paragraph explaining why their feature is absent, and
     * those paragraphs were written as fixed Malay text. A fixed string cannot
     * follow the reader's language, so a user who chose English still read Malay —
     * and the school's rule is that Malay is the default while English is
     * selectable. `explanationKey` is supported so those paragraphs can be moved
     * into the locale files one screen at a time, without a single flag day.
     */
    explanation: string;
    explanationKey?: string;
    titleKey?: string;
    handleBack: () => void;
}

/**
 * A screen for a feature the school has not switched on yet.
 *
 * WHY THIS EXISTS. Several teacher screens are reachable from the dashboard and
 * call an Express server that is not deployed, for data this school does not keep:
 * SOP case notes, observation records, appointment requests, substitute cover,
 * virtual classrooms, pickup authorisations, lesson plans, at-risk flags, support
 * and maintenance tickets. No table holds any of it.
 *
 * Those screens showed a raw request failure. A teacher reaching one of them learns
 * that the app is broken, which is both alarming and untrue — nothing is broken;
 * the feature has simply not been built for this school yet. Saying so is better
 * than a stack of red text, and much better than a blank screen that looks like an
 * empty list of real records.
 *
 * This is deliberately NOT a fake. It shows no data and accepts no input. When one
 * of these features is built, its screen replaces this one.
 *
 * THE SCREEN'S OWN WORDS FOLLOW THE READER'S LANGUAGE. `Kembali` and the
 * accessibility label were hard-coded, so an English reader saw a Malay button on
 * an otherwise English screen — and the Malay default was the only thing that made
 * it look right. Both now come from the locale files.
 */
const ComingSoonScreen: React.FC<ComingSoonScreenProps> = ({
    title,
    explanation,
    explanationKey,
    titleKey,
    handleBack,
}) => {
    const { t } = useTranslation();

    // A key wins when given, so a screen can be migrated to translations without
    // changing its call site shape. The literal remains the fallback: if the key
    // is missing from a locale, the reader still gets a real sentence rather than
    // the raw key echoed back at them.
    const shownTitle = titleKey ? t(titleKey, { defaultValue: title }) : title;
    const shownExplanation = explanationKey
        ? t(explanationKey, { defaultValue: explanation })
        : explanation;

    return (
        <div className="flex flex-col h-full bg-gray-50">
            <div className="flex-grow flex items-center justify-center p-6">
                <div className="max-w-md text-center space-y-4">
                    <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
                        <span className="text-2xl" role="img" aria-label={t('comingSoon.notAvailable')}>
                            🚧
                        </span>
                    </div>
                    <h2 className="text-lg font-bold text-gray-800">{shownTitle}</h2>
                    <p className="text-sm text-gray-600">{shownExplanation}</p>
                    <button
                        onClick={handleBack}
                        className="mt-2 px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
                    >
                        {t('comingSoon.back')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ComingSoonScreen;
