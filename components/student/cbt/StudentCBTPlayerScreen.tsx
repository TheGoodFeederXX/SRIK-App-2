import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../../ui/ComingSoonScreen';

/**
 * CBT player — replaced, because there is no test to sit and nowhere to submit an answer. The
 * player fetched questions for a test and submitted the answers; neither questions nor
 * submissions are stored anywhere, and both calls went to an undeployed server.
 * 
 * It is not rebuilt here for the reason given on the quizzes screen, and it matters more here
 * because this screen COLLECTED answers. A child could work through a test, submit it, and see
 * it acknowledged, while the school received nothing at all — and the child would reasonably
 * believe they had been examined.
 */
interface StudentCBTPlayerScreenProps {
    test?: { id?: string; title?: string } | null;
    studentId?: number | string;
    handleBack?: () => void;
}

const StudentCBTPlayerScreen: React.FC<StudentCBTPlayerScreenProps> = ({ test, studentId, handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('studentCBTPlayerScreen.ujianKomputer')}
        explanation={
            'Ujian secara komputer belum tersedia di dalam sistem ini. Buat masa ini ' +
            'ujian murid dijalankan di dalam kelas melalui kaedah yang ditetapkan ' +
            'sekolah, dan markahnya direkodkan oleh guru melalui menu Penilaian. Sila ' +
            'hubungi guru kelas untuk urusan berkaitan ujian murid.'
        }
        handleBack={handleBack}
    />
    );
};

export default StudentCBTPlayerScreen;
