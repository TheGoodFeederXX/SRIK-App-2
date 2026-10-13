import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Salary configuration — replaced, and this is the one where guessing would have been worst. The screen computed each teacher's salary from a set of tax brackets and a pension rate held in the source code, then saved the configuration. NO salary or payroll table exists.
 * 
 * The rates themselves are the reason this is not rebuilt by filling in the blanks. The brackets in the file are not Malaysia's current income-tax bands and the pension rate is not the current KWSP or PERKESO figure. Copying a plausible-looking table into a payroll screen would produce payslips that are wrong by an amount nobody could see — for real people, against real obligations, with the school carrying the liability. It needs the figures that are actually in force, and I will not invent them.
 */
interface SalaryConfigurationProps {
    handleBack: () => void;
}

const SalaryConfiguration: React.FC<SalaryConfigurationProps> = ({ handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('salaryConfiguration.konfigurasiGaji')}
        explanation={
            'Pengurusan gaji guru belum tersedia di dalam sistem ini. Buat masa ini ' +
            'urusan gaji dikendalikan oleh pihak pengurusan sekolah di luar sistem, ' +
            'dan jumlahnya bergantung kepada jadual cukai serta caruman yang berkuat ' +
            'kuasa. Sila hubungi pejabat atau guru besar untuk urusan berkaitan gaji.'
        }
        handleBack={handleBack}
    />
    );
};

export default SalaryConfiguration;
