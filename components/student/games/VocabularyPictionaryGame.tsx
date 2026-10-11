import React from 'react';
import ComingSoonScreen from './../../ui/ComingSoonScreen';

/**
 * AUDIT F27 — a feature this school does not have.
 *
 * WHAT THIS REPLACED. This screen read and wrote through an Express server that is
 * not deployed, for data this school does not keep. No table holds it, so every list
 * came back empty and every save failed.
 *
 * AN EMPTY LIST IS THE WORST WAY TO SHOW THAT. It reads as "there is nothing here
 * yet", which is a claim about the school — that no incident has been reported, that
 * no observation has been made, that nobody is at risk. The screen was making that
 * claim while simply being unable to reach its data. Saying "not built yet" is true
 * and harmless; a blank list of real-looking records is neither.
 *
 * This shows no data and accepts no input. It is not a placeholder that pretends to
 * work — it is a statement that this part does not exist yet.
 */
const VocabularyPictionaryGame: React.FC<any> = ({ handleBack }) => (
    <ComingSoonScreen
        title="Vocabulary Pictionary Game"
        explanation="Vocabulary Pictionary Game is not built for this school yet. The service behind it is not running, and no records are kept for it, so nothing here would be real. When it is built, this screen will be replaced."
        handleBack={handleBack}
    />
);

export default VocabularyPictionaryGame;
