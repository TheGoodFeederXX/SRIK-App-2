import { toast } from 'react-hot-toast';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShareIcon, GameControllerIcon } from '../../../constants';

interface MathSprintResultsScreenProps {
    score: number;
    questionsAnswered: number;
    navigateTo: (view: string, title: string, props?: any) => void;
}

const MathSprintResultsScreen: React.FC<MathSprintResultsScreenProps> = ({ score, questionsAnswered, navigateTo }) => {
    const { t } = useTranslation();

    const accuracy = questionsAnswered > 0 ? Math.round((score / (questionsAnswered * 10)) * 100) : 0;

    const handleShare = () => {
        if (navigator.share) {
            navigator.share({
                title: t('mathSprintResultsScreen.myMathSprintScore'),
                text: `I just scored ${score} points in Math Sprint by answering ${questionsAnswered} questions! Can you beat my score?`,
            }).catch((error) => console.log('Error sharing:', error));
        } else {
            toast.error(t('mathSprintResultsScreen.sharingIsNotSupportedOnThisBrowser'));
        }
    };

    return (
        <div className="p-6 flex flex-col items-center justify-center h-full text-center bg-gray-50">
            <h1 className="text-2xl font-bold text-gray-800">{t('mathSprintResultsScreen.gameOver')}</h1>

            <div className="my-6">
                <p className="text-sm text-gray-500">{t('mathSprintResultsScreen.yourScore')}</p>
                <p className="text-7xl font-bold text-orange-500">{score}</p>
            </div>

            <div className="w-full max-w-sm grid grid-cols-2 gap-4 text-center">
                <div className="bg-white p-4 rounded-xl shadow-sm">
                    <p className="font-bold text-2xl text-sky-600">{questionsAnswered}</p>
                    <p className="text-xs text-gray-500 font-medium">{t('mathSprintResultsScreen.answered')}</p>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm">
                    <p className="font-bold text-2xl text-green-600">{accuracy}%</p>
                    <p className="text-xs text-gray-500 font-medium">{t('mathSprintResultsScreen.accuracy')}</p>
                </div>
            </div>

            <div className="w-full max-w-sm mt-8 space-y-3">
                <button
                    onClick={() => navigateTo('mathSprintLobby', t('mathSprintResultsScreen.mathSprint'), {})}
                    className="w-full py-3 text-lg font-bold text-white bg-orange-500 rounded-xl shadow-lg hover:bg-orange-600 transition-colors flex items-center justify-center space-x-2"
                >
                    <GameControllerIcon />
                    <span>{t('mathSprintResultsScreen.playAgain')}</span>
                </button>
                <button
                    onClick={handleShare}
                    className="w-full py-3 text-lg font-bold text-orange-600 bg-white border-2 border-orange-500 rounded-xl shadow-lg hover:bg-orange-50 transition-colors flex items-center justify-center space-x-2"
                >
                    <ShareIcon />
                    <span>{t('mathSprintResultsScreen.shareResults')}</span>
                </button>
            </div>
        </div>
    );
};

export default MathSprintResultsScreen;