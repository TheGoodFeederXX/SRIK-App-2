import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Onboarding pematuhan — replaced, because there is no separate compliance step here. The
 * page collected a school's compliance documents one screen at a time and then announced
 * completion. No compliance table exists, and the school is already set up and running. It is
 * not rebuilt here because this school has one configuration row holding the details it
 * actually has, and a wizard that walks through collecting them afresh could overwrite the
 * real values — including the school's own address and phone number — with blanks.
 */
interface ComplianceOnboardingPageProps {
    onComplete?: () => void;
    schoolId?: string;
    handleBack?: () => void;
}

const ComplianceOnboardingPage: React.FC<ComplianceOnboardingPageProps> = ({ onComplete, schoolId, handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('complianceOnboardingPage.pendaftaranPematuhan')}
        explanation={
            'Proses pendaftaran pematuhan tidak diperlukan kerana sekolah ini sudah ' +
            'berdaftar dan beroperasi. Maklumat dan dokumen sekolah boleh dikemas ' +
            'kini melalui menu Tetapan Sekolah. Sila hubungi pejabat jika terdapat ' +
            'maklumat sekolah yang perlu diubah.'
        }
        handleBack={handleBack || onComplete}
    />
    );
};

export default ComplianceOnboardingPage;
