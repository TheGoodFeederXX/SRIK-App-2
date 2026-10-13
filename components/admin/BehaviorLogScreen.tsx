import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Behaviour log — replaced, because no such record is kept here. The screen listed behaviour notes per child and let staff add more. There is NO `behavior_notes` table, and every call went to an undeployed server. It is not rebuilt here on purpose: a behaviour record follows a child through their years at the school and shapes how staff treat them. Who may write an entry, who may read it, whether a parent sees it, and whether it can be deleted are decisions with real consequences for a child, and they are the school's to make.
 */
interface BehaviorLogScreenProps {
    handleBack?: () => void;
}

const BehaviorLogScreen: React.FC<BehaviorLogScreenProps> = ({ handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('behaviorLogScreen.logTingkahLaku')}
        explanation={
            'Sekolah belum menyimpan rekod tingkah laku murid di dalam sistem ini. ' +
            'Buat masa ini catatan tingkah laku murid dibuat dan disimpan secara ' +
            'bertulis di pejabat. Rekod seperti ini melibatkan murid secara peribadi, ' +
            'jadi sekolah perlu menetapkan dahulu siapa yang boleh melihatnya dan ' +
            'bagaimana ia digunakan sebelum ia dipindahkan ke dalam sistem.'
        }
        handleBack={handleBack}
    />
    );
};

export default BehaviorLogScreen;
