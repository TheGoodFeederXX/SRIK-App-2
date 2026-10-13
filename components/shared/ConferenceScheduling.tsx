import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Conference scheduling — replaced, because no meeting is booked here. Parents picked a child,
 * chose a slot and booked a slot with a teacher; there is no conference or appointment table,
 * and every call went to an undeployed server. This matches the parent appointment screen,
 * which was replaced for the same reason. It is not rebuilt here because booking a teacher's
 * time is a commitment made to a family on a specific date — a slot that appears booked to the
 * parent but is not in the teacher's diary is worse than no booking screen at all.
 */
interface ConferenceSchedulingProps {
    handleBack?: () => void;
}

const ConferenceScheduling: React.FC<ConferenceSchedulingProps> = ({ handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('conferenceScheduling.penjadualanPerjumpaan')}
        explanation={
            'Sekolah belum membuka tempahan perjumpaan guru secara dalam talian. Buat ' +
            'masa ini sebarang pertemuan dengan guru boleh diatur terus melalui ' +
            'pejabat sekolah di 010-511 9582 atau melalui guru kelas. Ini bagi ' +
            'memastikan masa guru dan ibu bapa benar-benar dipersetujui oleh ' +
            'kedua-dua pihak.'
        }
        handleBack={handleBack}
    />
    );
};

export default ConferenceScheduling;
