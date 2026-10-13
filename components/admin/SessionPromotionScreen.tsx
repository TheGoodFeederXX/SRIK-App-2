import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Session promotion — replaced, because moving a whole year group up is not a button here.
 * The screen listed the children in a class and promoted them all into the next year in one
 * action. It read from an undeployed server and there is no promotion table.
 * 
 * It is not rebuilt here because promoting a year group is not a bulk edit. A child may be
 * kept back, another may be skipped, and some may have left; each of those is a decision made
 * by the school and recorded against the child. A single "promote all" that cannot express any
 * of it would produce a register that quietly disagrees with what the school actually decided.
 * Promotion belongs on the child's own record, where the exceptions can be stated.
 */
interface SessionPromotionScreenProps {
    schoolId?: string;
    currentBranchId?: string;
    handleBack?: () => void;
}

const SessionPromotionScreen: React.FC<SessionPromotionScreenProps> = ({ handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('sessionPromotionScreen.naikKelas')}
        explanation={
            'Penaikan kelas secara pukal belum tersedia di dalam sistem ini. Buat ' +
            'masa ini naik kelas murid diuruskan melalui rekod murid masing-masing, ' +
            'supaya murid yang tinggal kelas, yang melompat kelas atau yang telah ' +
            'berpindah dapat direkodkan dengan betul. Sila hubungi pejabat untuk ' +
            'urusan berkaitan naik kelas murid.'
        }
        handleBack={handleBack}
    />
    );
};

export default SessionPromotionScreen;
