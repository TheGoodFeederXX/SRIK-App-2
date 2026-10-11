import React from 'react';
import ComingSoonScreen from '../ui/ComingSoonScreen';

interface LearningHubProgressScreenProps {
    navigateTo: (view: string, title: string, props?: any) => void;
    students?: unknown[];
    loading?: boolean;
}

/**
 * NOT BUILT FOR THIS SCHOOL — and the screen now says that instead of showing zeroes.
 *
 * There is no learning-hub, no e-learning progress and no topic tracking in this
 * database: no `learning_hub` table, no per-topic progress, nothing. Every figure this
 * screen used to display — topics completed, hours studied, badges, streaks — came from
 * a server that is not deployed, so what a parent actually saw was a set of zeroes and
 * empty bars that looked like a child who had done nothing.
 *
 * That is the worst kind of wrong answer, because it is believable. A parent has no way
 * to tell "your child has not started" from "this was never built". Saying so is
 * honest; a dashboard of zeros is not.
 */
const LearningHubProgressScreen: React.FC<LearningHubProgressScreenProps> = ({ navigateTo }) => (
    <ComingSoonScreen
        title="Progress Pembelajaran"
        explanation={
            'Sekolah ini belum menyediakan rekod kemajuan pembelajaran dalam talian. '
            + 'Skrin ini sebelum ini memaparkan angka sifar, yang boleh disalah anggap '
            + 'sebagai anak anda belum membuat apa-apa. Untuk kemajuan pelajaran anak '
            + 'anda, sila rujuk laporan prestasi atau hubungi pihak sekolah.'
        }
        handleBack={() => navigateTo('home', 'Utama')}
    />
);

export default LearningHubProgressScreen;
