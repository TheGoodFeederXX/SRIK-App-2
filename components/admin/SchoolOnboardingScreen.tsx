import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * School onboarding — replaced, because this school is already set up. The wizard walked a new school through its profile, documents and curriculum, then saved it — but `school_profile` is the ONE configuration row for the ONE school, and it already holds the school's real name, address and phone number. Completing this wizard could only overwrite them. School details are edited on the settings screen instead, which is the place for a change to something already in use.
 */
interface SchoolOnboardingScreenProps {
    handleBack?: () => void;
}

const SchoolOnboardingScreen: React.FC<SchoolOnboardingScreenProps> = ({ handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('schoolOnboardingScreen.pendaftaranSekolah')}
        explanation={
            'Sekolah ini sudah didaftarkan dan digunakan, jadi proses pendaftaran ' +
            'awal tidak lagi diperlukan. Maklumat sekolah boleh dikemas kini melalui ' +
            'menu Tetapan Sekolah. Sila hubungi pejabat jika terdapat maklumat ' +
            'sekolah yang perlu diubah.'
        }
        handleBack={handleBack}
    />
    );
};

export default SchoolOnboardingScreen;
