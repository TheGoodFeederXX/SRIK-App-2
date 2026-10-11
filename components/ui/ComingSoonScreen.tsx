import React from 'react';

interface ComingSoonScreenProps {
    /** What the teacher came here for, in their own words. */
    title: string;
    /**
     * Why it is not ready, said plainly. Not "an error occurred" — the person
     * reading this is a teacher, and "this part is not built yet" is a complete
     * and honest answer.
     */
    explanation: string;
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
 */
const ComingSoonScreen: React.FC<ComingSoonScreenProps> = ({ title, explanation, handleBack }) => (
    <div className="flex flex-col h-full bg-gray-50">
        <div className="flex-grow flex items-center justify-center p-6">
            <div className="max-w-md text-center space-y-4">
                <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
                    <span className="text-2xl" role="img" aria-label="Belum tersedia">🚧</span>
                </div>
                <h2 className="text-lg font-bold text-gray-800">{title}</h2>
                <p className="text-sm text-gray-600">{explanation}</p>
                <button
                    onClick={handleBack}
                    className="mt-2 px-5 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
                >
                    Kembali
                </button>
            </div>
        </div>
    </div>
);

export default ComingSoonScreen;
