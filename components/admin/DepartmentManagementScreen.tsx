import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Department management — replaced, because this school has no departments. The screen created departments, allocated budgets and recorded meetings. There is no department table, and the school is one school with one administration: teachers, a head teacher and an office. A department list would be a structure this school does not have, and a budget ledger with no budget behind it is worse than none — it would look like the school tracks its spending here. It does not.
 */
interface DepartmentManagementScreenProps {
    handleBack?: () => void;
}

const DepartmentManagementScreen: React.FC<DepartmentManagementScreenProps> = ({ handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('departmentManagementScreen.pengurusanJabatan')}
        explanation={
            'Sekolah ini tidak mempunyai jabatan berasingan, jadi tiada senarai ' +
            'jabatan di sini. Buat masa ini urusan pentadbiran dijalankan terus ' +
            'melalui pejabat dan guru besar. Sila hubungi pejabat untuk sebarang ' +
            'urusan pentadbiran.'
        }
        handleBack={handleBack}
    />
    );
};

export default DepartmentManagementScreen;
