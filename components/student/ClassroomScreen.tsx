import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Classroom — replaced, because the room it described does not exist here. It showed a
 * subject's lesson notes, curriculum topics, class list and peers, none of which is stored: no
 * lesson-note table and no curriculum-topic table. Every item came from an undeployed server.
 * 
 * It is not rebuilt here because a child's own subject pages already exist and read real data —
 * their assessments, their attendance and their report cards. A second classroom view that
 * invents its contents, shown to a nine-year-old who cannot tell a real screen from a broken
 * one, is the wrong thing to leave in its place.
 */
interface ClassroomScreenProps {
  subjectName: string;
  navigateTo: (view: string, title: string, props?: any) => void;
}

const ClassroomScreen: React.FC<ClassroomScreenProps> = ({ subjectName, navigateTo }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('classroomScreen.bilikDarjah')}
        explanation={
            'Halaman bilik darjah belum tersedia di dalam sistem ini. Buat masa ini ' +
            'murid boleh melihat markah penilaian, rekod kehadiran dan laporan ' +
            'prestasi melalui menu masing-masing. Bahan pembelajaran dan nota ' +
            'pelajaran disediakan oleh guru secara langsung di dalam kelas. Sila ' +
            'hubungi guru kelas untuk urusan berkaitan pembelajaran.'
        }
        handleBack={navigateTo ? () => navigateTo('studentDashboard', 'Papan Pemuka') : undefined}
    />
    );
};

export default ClassroomScreen;
