package models

import models.Game.{GameId, PlayerId}

case class PileView(top: Seq[Card], drawable: Seq[DrawableCard], bottom: Int)

object PileView {
  def fromPile(pile: Pile): PileView =
    PileView(pile.top, pile.drawable, pile.bottom.size)
}

case class GameStateView(
    id: GameId,
    version: Int,
    me: Player,
    otherPlayers: Seq[PlayerView],
    currentPlayer: PlayerId,
    nextAction: GameAction,
    pile: PileView,
    deck: Int,
    ending: Option[GameResult]
)

object GameStateView {
  def fromGameState(gameState: GameState, playerId: PlayerId): GameStateView = {
    val me = gameState.players.find(_.id == playerId).get
    val otherPlayers =
      gameState.players.filterNot(Set(me)).map { player =>
        if (gameState.ending.isDefined)
          FullPlayerView.fromPlayer(player)
        else
          PartialPlayerView.fromPlayer(player)
      }
    GameStateView(
      gameState.id,
      gameState.version,
      me,
      otherPlayers,
      gameState.currentPlayer,
      gameState.nextAction,
      PileView.fromPile(gameState.pile),
      gameState.deck.size,
      gameState.ending
    )
  }
}

trait PlayerView {
  val id: PlayerId
  val name: String
  val numCards: Int
}

case class FullPlayerView(id: PlayerId, name: String, numCards: Int, cards: Seq[Card]) extends PlayerView

object FullPlayerView {
  def fromPlayer(player: Player): FullPlayerView = {
    FullPlayerView(player.id, player.name, player.cards.size, player.cards)
  }
}

case class PartialPlayerView(id: PlayerId, name: String, numCards: Int) extends PlayerView

object PartialPlayerView {
  def fromPlayer(player: Player): PartialPlayerView = {
    PartialPlayerView(player.id, player.name, player.cards.size)
  }
}
