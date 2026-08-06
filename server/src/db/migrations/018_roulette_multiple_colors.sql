ALTER TABLE roulette_bets
  DROP CONSTRAINT IF EXISTS roulette_bets_round_number_user_id_key;

ALTER TABLE roulette_bets
  ADD CONSTRAINT roulette_bets_round_number_user_id_color_key
  UNIQUE (round_number, user_id, color);
