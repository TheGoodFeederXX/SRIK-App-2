import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Student ID cards — replaced, because no card is produced here. The dashboard showed card statistics and a per-child list, reading from an undeployed server; there is no card table and no card generator. It is not rebuilt here because a school ID card is a physical object with the school's identity printed on it — producing one means deciding the layout, the size, what appears on the reverse and who prints it, and a card that is wrong is a card that has to be recalled from every child who received one.
 */
interface StudentIDCardDashboardProps {
    handleBack?: () => void;
}

const StudentIDCardDashboard: React.FC<StudentIDCardDashboardProps> = ({ handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('studentIDCardDashboard.kadPengenalanMurid')}
        explanation={
            'Sekolah belum mencetak kad pengenalan murid melalui sistem ini. Buat ' +
            'masa ini kad pengenalan murid disediakan secara berasingan oleh pejabat. ' +
            'Sila hubungi pejabat untuk sebarang urusan berkaitan kad pengenalan ' +
            'murid.'
        }
        handleBack={handleBack}
    />
    );
};

export default StudentIDCardDashboard;
