
import React from 'react';
import { useTranslation } from 'react-i18next';
import { MessagesIcon, LockIcon } from '../../constants';

const NoChatSelected: React.FC = () => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 bg-[#F0F2F5] border-l border-gray-300/80 relative">
            <MessagesIcon className="w-24 h-24 text-gray-300" />
            <h1 className="text-3xl font-light text-gray-600 mt-4">{t('noChatSelected.schoolAppMessaging')}</h1>
            <p className="mt-2 text-sm text-gray-500 max-w-sm">
                {t('noChatSelected.sendAndReceiveHere')}
            </p>
            <p className="mt-1 text-sm text-gray-500">
                {t('common.selectConversationToStart')}
            </p>

            <div className="absolute bottom-8 text-xs text-gray-400 flex items-center">
                <LockIcon className="w-3 h-3 mr-1.5" />
                Your personal messages are end-to-end encrypted
            </div>
        </div>
    );
};
export default NoChatSelected;
