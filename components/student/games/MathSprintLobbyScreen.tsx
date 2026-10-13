import { toast } from 'react-hot-toast';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShareIcon } from '../../../constants';

import { Student } from '../../../types';

interface MathSprintLobbyScreenProps {
    navigateTo: (view: string, title: string, props?: any) => void;
    student?: Student;
}

const MathSprintLobbyScreen: React.FC<MathSprintLobbyScreenProps> = ({ navigateTo, student }) => {
    const { t } = useTranslation();

    const handleShareChallenge = () => {
        if (navigator.share) {
            navigator.share({
                title: t('mathSprintLobbyScreen.mathSprintChallenge'),
                text: "Think you're faster at math? Challenge me in Math Sprint on the Smart School App!",
            }).catch((error) => console.log('Error sharing:', error));
        } else {
            toast(t('mathSprintLobbyScreen.sharingIsNotSupportedOnYourBrowserYouCanCopyTh'), { icon: '📋' });
        }
    };

    return (
        <div className="p-6 flex flex-col items-center justify-center h-full text-center bg-gray-50">
            <div className="w-24 h-24 rounded-full bg-sky-500 text-white flex items-center justify-center text-4xl font-bold mb-4 shadow-lg">
                123
            </div>
            <h1 className="text-3xl font-bold text-gray-800">{t('mathSprintLobbyScreen.mathSprint')}</h1>
            <p className="text-gray-600 mt-2 max-w-xs">{t('mathSprintLobbyScreen.answerAsManyMathProblemsAsYouCanBeforeTheTimer')}</p>

            <div className="w-full max-w-sm mt-8 space-y-4">
                <button
                    onClick={() => navigateTo('mathSprintGame', t('mathSprintLobbyScreen.mathSprint'), { student })}
                    className="w-full py-4 text-lg font-bold text-white bg-orange-500 rounded-xl shadow-lg hover:bg-orange-600 transition-colors"
                >
                    Play Solo
                </button>

                <button
                    onClick={handleShareChallenge}
                    className="w-full py-4 text-lg font-bold text-orange-600 bg-white border-2 border-orange-500 rounded-xl shadow-lg hover:bg-orange-50 transition-colors flex items-center justify-center space-x-2"
                >
                    <ShareIcon />
                    <span>{t('mathSprintLobbyScreen.challengeAFriend')}</span>
                </button>
            </div>
        </div>
    );
};

export default MathSprintLobbyScreen;