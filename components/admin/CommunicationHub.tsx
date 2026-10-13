import React from 'react';
import { useTranslation } from 'react-i18next';
import ComingSoonScreen from '../ui/ComingSoonScreen';

/**
 * Communication hub — replaced, because the one part of it that worked already exists elsewhere. This screen gathered notices, notifications and dashboard counts behind one send button. There is no `notifications` table at all, and the notice send went to an undeployed server. Publishing to families IS supported — through the announcements screen, which separates saving a draft from publishing it, so a notice reaching hundreds of parents is a deliberate act rather than a side effect. A second door onto the same thing, with fewer safeguards, is the last thing this needs.
 */
interface CommunicationHubProps {
    handleBack?: () => void;
}

const CommunicationHub: React.FC<CommunicationHubProps> = ({ handleBack }) => {
    const { t } = useTranslation();
    return (
    <ComingSoonScreen
        title={t('communicationHub.habKomunikasi')}
        explanation={
            'Pengumuman kepada ibu bapa disediakan melalui menu Pengumuman, bukan di ' +
            'sini. Ini kerana menghantar pengumuman kepada keluarga adalah tindakan ' +
            'rasmi pejabat, dan ia perlu disemak serta diterbitkan dengan sengaja. ' +
            'Sila gunakan menu Pengumuman untuk urusan tersebut.'
        }
        handleBack={handleBack}
    />
    );
};

export default CommunicationHub;
