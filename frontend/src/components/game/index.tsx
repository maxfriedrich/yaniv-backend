import { h, Component } from 'preact';

import { CardType, GameSeriesStateType, FullPlayerCardsViewType, PartialPlayerCardsViewType } from './api';

import { applyDrag } from './drag';

import { Scores } from './scores';
import { Pile, Deck } from './table';
import { Hand } from './hand'; 
import { NextGameControls } from './next';
import { Actions } from './actions';

interface GameComponentPropsType { gameId?: string; playerId?: string; debug?: boolean; path: string }

interface GameComponentStateType {
	selected: CardType[];
	sortedCards: CardType[];
	cardOnDeck?: CardType;
	serverState: GameSeriesStateType;
}

export class Game extends Component<GameComponentPropsType, GameComponentStateType> {
	scheduled?: ReturnType<typeof setTimeout>
	source?: EventSource

	constructor() {
		super();
		this.state = {
			selected: [], // sorted
			sortedCards: [],
			cardOnDeck: null,
			serverState: {
				id: 0,
				version: 0,
				me: '',
				players: [],
				state: {
					state: 'waitingForSeriesStart'
				},
				currentGame: null,
				scores: new Map(),
				scoresDiff: new Map()
			}
		};
		this.scheduled = null;
	}

	isCurrentGame = () => this.state.serverState.state.state === 'gameIsRunning';

	isPastGame = () => this.state.serverState.state.state === 'waitingForNextGame' || this.state.serverState.state.state === 'gameOver';

	isCurrentPlayer = () => this.isCurrentGame() && this.state.serverState.currentGame.currentPlayer === this.state.serverState.me;

	myName = () => this.state.serverState.players.find(p => p.id === this.state.serverState.me).name;

	playerCards = (playerId: string): CardType[] | number => {
		if (!this.isCurrentGame() && !this.isPastGame()) {
			return null;
		}
		if (playerId === this.state.serverState.me) {
			const myCards = this.state.serverState.currentGame.me.cards;
			return this.isPastGame() ? myCards : myCards.length;
		}
		const otherPlayers = this.state.serverState.currentGame.otherPlayers;
		console.log('otherplayers:', otherPlayers);
		if (otherPlayers.length === 0) {
			return null;
		}
		
		// TODO: this is not nice but I don't know any better
		return 'cards' in otherPlayers[0] ?
			(otherPlayers as FullPlayerCardsViewType[]).find(p => p.id === playerId).cards :
			(otherPlayers as PartialPlayerCardsViewType[]).find(p => p.id === playerId).numCards;
	}

	playerInfo = () => {
		if (!this.state.serverState.players) return [];
		return this.state.serverState.players.map(player => (
			{
				name: player.name,
				isMe: player.id === this.state.serverState.me,
				isCurrentPlayer: this.isCurrentGame() && player.id === this.state.serverState.currentGame.currentPlayer,
				cards: this.playerCards(player.id),
				score: this.state.serverState.scores[player.id],
				scoreDiff: this.state.serverState.scoresDiff[player.id]
			}
		));
	}

	// `excluded` can be null, a card, or an array of cards
	updateSortedCards = (serverCards: CardType[], excluded?: CardType[]) => {
		const isExcluded = (id) => {
			if (!excluded) return false;
			return excluded.some(e => e.id === id);
		};
		
		const serverCardIds = serverCards.map(c => c.id);
		const handCards = this.state.sortedCards.filter(c => serverCardIds.includes(c.id));
		const handCardIds = handCards.map(c => c.id);
		const newCards = serverCards.filter(c => !(handCardIds.includes(c.id))).filter(c => !isExcluded(c.id));
		const result = handCards.concat(newCards.sort((a, b) => a.endValue - b.endValue));
		return result;
	}

	componentDidMount = () => {
		console.log('game component did mount');
		fetch(`/rest/game/${this.props.gameId}/player/${this.props.playerId}/state`)
			.then(response => response.json())
			.then((initialServerState) => {
				console.log('got initial server state:', initialServerState);
				const initialSortedCards = (initialServerState.currentGame) ? initialServerState.currentGame.me.cards.sort((a, b) => a.endValue - b.endValue) : [];
				this.setState({ serverState: initialServerState, sortedCards: initialSortedCards });
			})
			.catch(err => console.log(err));

		this.source = new EventSource(`/rest/game/${this.props.gameId}/player/${this.props.playerId}/state/stream`);
		this.source.onmessage = (event) => {
			const newServerState = JSON.parse(event.data.substring(5));
			console.log('Got new server state from stream:', newServerState);
			if (newServerState.version <= this.state.serverState.version) {
				console.log('not accepting server state with version', newServerState.version);
				return;
			}
			if (newServerState.state.state === 'gameIsRunning') {
				let newSortedCards;
				const isNewGame = this.state.serverState.state.state === 'waitingForNextGame';
				if (isNewGame) {
					newSortedCards = newServerState.currentGame.me.cards.sort((a, b) => a.endValue - b.endValue);
				}
				else {
					const excluded = this.state.selected.concat(newServerState.currentGame.me.drawThrowable || []);
					newSortedCards = this.updateSortedCards(newServerState.currentGame.me.cards, excluded);
				}
				this.setState({ serverState: newServerState, sortedCards: newSortedCards, cardOnDeck: null });
			}
			else {
				console.log('game over');
				clearTimeout(this.scheduled);
				this.scheduled = null;
				const newSortedCards = this.updateSortedCards(newServerState.currentGame.me.cards, []);
				console.log(newSortedCards);
				this.setState({ serverState: newServerState, selected: [], sortedCards: newSortedCards, cardOnDeck: null });
			}
		};
		this.source.onerror = (error) => console.log(error);
	}

	componentWillUnmount = () => {
		if (this.scheduled) clearTimeout(this.scheduled);
		this.source?.close();
	}

	selectCard = (card: CardType) => () => {
		const newSelection = this.state.selected.concat([card]);
		const newSortedCards = this.state.sortedCards.filter(c => c.id !== card.id);
		this.setState({ selected: newSelection, sortedCards: newSortedCards });
		console.log('Selecting card: ' + card.id);
	}

	unselectCard = (card: CardType) => () => {
		const newSelection = this.state.selected.filter(c => c.id !== card.id);
		const newSortedCards = this.state.sortedCards.concat([card]);
		this.setState({ selected: newSelection, sortedCards: newSortedCards });
		console.log('Unselecting card: ' + card.id);
	}

	updateSelectedOnDrop = (e) => this.setState({ selected: applyDrag(this.state.selected, e) })
	updateSortedCardsOnDrop = (e) => this.setState({ sortedCards: applyDrag(this.state.sortedCards, e) })

	isCurrentPlayerThrow = () => this.isCurrentPlayer() && this.state.serverState.currentGame && this.state.serverState.currentGame.nextAction === 'throw' && this.state.serverState.currentGame.ending == null;
	isCurrentPlayerDraw = () => this.isCurrentPlayer() && this.state.serverState.currentGame && this.state.serverState.currentGame.nextAction === 'draw' && this.state.serverState.currentGame.ending == null;

	isThrowDisabled = () => !this.isCurrentPlayerThrow() || this.state.selected.length === 0;
	isYanivDisabled = () => !this.isCurrentPlayerThrow() || this.state.selected.length > 0 || this.state.sortedCards.map(c => c.endValue).reduce((acc, x) => acc + x) > 5;

	drawFromPile = (card: CardType) => {
		console.log('Drawing from pile: ', card.id);
		fetch(`/rest/game/${this.props.gameId}/player/${this.props.playerId}/draw`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ source: card.id })
		})
			.then((response) => response.json())
			.then((newServerState) => {
				if ('error' in newServerState) {
					alert(JSON.stringify(newServerState.error));
				}
				else if (newServerState.state.state === 'gameIsRunning') {
					const newSortedCards = this.updateSortedCards(newServerState.currentGame.me.cards, newServerState.currentGame.me.drawThrowable);
					this.setState({ serverState: newServerState, sortedCards: newSortedCards });
				}
				else {
					this.setState({ serverState: newServerState });
				}
			}).catch(err => console.log(err));
	}

	drawFromDeck = () => {
		console.log('Drawing from deck');
		fetch(`/rest/game/${this.props.gameId}/player/${this.props.playerId}/draw`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ source: 'deck' })
		})
			.then((response) => response.json())
			.then((newServerState) => {
				// debugger;
				if ('error' in newServerState) {
					alert(JSON.stringify(newServerState.error));
				}
				else {
					this.setState({ serverState: newServerState, cardOnDeck: newServerState.currentGame.me.drawThrowable });
					clearTimeout(this.scheduled);
					this.scheduled = setTimeout(() => {
						if (this.state.cardOnDeck) {
							console.log('scheduled');
							const newSortedCards = this.updateSortedCards(newServerState.currentGame.me.cards, []);
							this.setState({ sortedCards: newSortedCards, cardOnDeck: null });
						}
					}, 3000);
				}
			}).catch(err => console.log(err));
	}

	throw = () => {
		console.log(this.state);
		const cardsToThrow = this.state.selected.map(card => card.id);
		console.log('Throwing cards: ' + this.state.selected.map(card => card.id));
		fetch(`/rest/game/${this.props.gameId}/player/${this.props.playerId}/throw`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cards: cardsToThrow })
		})
			.then((response) => response.json())
			.then((newServerState) => {
				if ('error' in newServerState) {
					alert(JSON.stringify(newServerState.error));
				}
				else {
					this.setState({ serverState: newServerState, selected: [] });
				}
			}).catch(err => console.log(err));
	}

	drawThrow = () => {
		console.log(this.state);
		console.log('Draw-throwing card: ' + this.state.serverState.currentGame.me.drawThrowable.id);
		fetch(`/rest/game/${this.props.gameId}/player/${this.props.playerId}/drawThrow`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ card: this.state.serverState.currentGame.me.drawThrowable.id })
		})
			.then((response) => response.json())
			.then((newServerState) => {
				if ('error' in newServerState) {
					alert(JSON.stringify(newServerState.error));
				}
				else {
					this.setState({ serverState: newServerState, cardOnDeck: null, selected: [] });
				}
			}).catch(err => console.log(err));
	}


	yaniv = () => {
		console.log(this.state);
		console.log('Calling yaniv');
		fetch(`/rest/game/${this.props.gameId}/player/${this.props.playerId}/yaniv`, {
			method: 'POST'
		})
			.then((response) => response.json())
			.then((newServerState) => {
				if ('error' in newServerState) {
					alert(JSON.stringify(newServerState.error));
				}
				else {
					this.setState({ serverState: newServerState, selected: [] });
				}
			}).catch(err => console.log(err));
	}

	nextGame = () => {
		console.log('next game');
		fetch(`/rest/game/${this.props.gameId}/player/${this.props.playerId}/next`, {
			method: 'POST'
		})
			.then((response) => response.json())
			.then((newServerState) => {
				if ('error' in newServerState) {
					alert(JSON.stringify(newServerState.error));
				}
			}).catch(err => console.log(err));
	}

	render = ({ debug }: GameComponentPropsType, { selected, sortedCards, cardOnDeck, serverState }: GameComponentStateType) => (
		<div class="game">
			<Scores players={this.playerInfo()} showScoreDiff={serverState && (serverState.state.state === 'waitingForNextGame' || serverState.state.state === 'gameOver')} />

			<div class="card bg-light my-2">
				{this.isCurrentGame() || this.isPastGame() ? (
					<div class="table-container">
						<Pile pile={serverState.currentGame.pile}
							disabled={!this.isCurrentPlayerDraw()}
							drawAction={this.drawFromPile}
						/>
						<Deck deck={serverState.currentGame.deck}
							cardOnDeck={cardOnDeck}
							disabled={!this.isCurrentPlayerDraw()}
							drawAction={this.drawFromDeck}
							drawThrowAction={this.drawThrow}
						/>
					</div>
				) : (<div class="table-container" />)}
			</div>

			<div class="card my=2">
				<div class="hand-container">
					<div class="card-header">
						{(serverState.currentGame && serverState.currentGame.ending) ?
							<NextGameControls
								players={serverState.players}
								currentGame={serverState.currentGame}
								seriesState={serverState.state}
								alreadyAccepted={serverState.state.acceptedPlayers && serverState.state.acceptedPlayers.includes(serverState.me)}
								nextGameAction={this.nextGame}
							/> : (
								<Actions
									throwDisabled={this.isThrowDisabled()}
									throwAction={this.throw}
									yanivDisabled={this.isYanivDisabled()}
									yanivAction={this.yaniv}
								/>)}
					</div>

					<Hand
						id='selected-container'
						active={this.isCurrentPlayerThrow()}
						inactiveSortingAllowed={false}
						cards={selected}
						onDrop={this.updateSelectedOnDrop}
						cardAction={this.unselectCard} 
					/>
					<Hand
						active={this.isCurrentPlayerThrow()}
						classes='border-top'
						inactiveSortingAllowed={true}
						cards={sortedCards}
						onDrop={this.updateSortedCardsOnDrop}
						cardAction={this.selectCard}
					/>
				</div>
			</div>
			{debug ? (<pre>
				state: {JSON.stringify(serverState, undefined, 2)}
			</pre>) : <div />}
		</div>
	)
}
