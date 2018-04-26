/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as _ from './table';
import * as Lifecycle from 'vs/base/common/lifecycle';
import * as DOM from 'vs/base/browser/dom';
import * as Browser from 'vs/base/browser/browser';
import * as Touch from 'vs/base/browser/touch';
import * as Keyboard from 'vs/base/browser/keyboardEvent';
import * as Mouse from 'vs/base/browser/mouseEvent';
import * as Platform from 'vs/base/common/platform';
import * as Model from './tableModel';
import Event, { Emitter } from 'vs/base/common/event';
import { HeightMap, IViewRow, IViewCell } from './tableViewModel';
import { ScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { KeyCode } from 'vs/base/common/keyCodes';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';

export interface ICell {
	element: HTMLElement;
	templateId: string;
	templateData: any;
}

function removeFromParent(element: HTMLElement): void {
	try {
		element.parentElement.removeChild(element);
	} catch (e) {
		// this will throw if this happens due to a blur event, nasty business
	}
}

export class CellCache implements Lifecycle.IDisposable {
	private _cache: { [templateId: string]: ICell[]; };

	constructor(private context: _.ITableContext) {
		this._cache = { '': [] };
	}

	public alloc(templateId: string): ICell {
		var result = this.cache(templateId).pop();

		if (!result) {
			var content = document.createElement('div');
			content.className = 'content';

			var cell = document.createElement('td');
			cell.appendChild(content);

			result = {
				element: cell,
				templateId: templateId,
				templateData: this.context.renderer.renderTemplate(this.context.table, templateId, content)
			};
		}

		return result;
	}

	public release(templateId: string, row: ICell): void {
		removeFromParent(row.element);
		this.cache(templateId).push(row);
	}

	private cache(templateId: string): ICell[] {
		return this._cache[templateId] || (this._cache[templateId] = []);
	}

	public garbageCollect(): void {
		if (this._cache) {
			Object.keys(this._cache).forEach(templateId => {
				this._cache[templateId].forEach(cachedRow => {
					this.context.renderer.disposeTemplate(this.context.table, templateId, cachedRow.templateData);
					cachedRow.element = null;
					cachedRow.templateData = null;
				});

				delete this._cache[templateId];
			});
		}
	}

	public dispose(): void {
		this.garbageCollect();
		this._cache = null;
		this.context = null;
	}
}

export interface IViewContext extends _.ITableContext {
	cache: CellCache;
}

export class ViewRow implements IViewRow {
	public model: Model.Row;
	public id: string;
	protected row: IRow;

	public top: number;
	public height: number;

	public _styles: any;

	private _templateId: string;
	private get templateId(): string {
		return this._templateId || (this._templateId = (this.context.renderer.getTemplateId && this.context.renderer.getTemplateId(this.context.table, this.model.getElement())));
	}

	constructor(private context: IViewContext, privatemodel: Model.Row) {
		this.id = this.model.id;
		this.row = null;

		this.top = 0;
		this.height = this.model.getHeight();

		this._styles = {};
		this.model.getAllTraits().forEach(t => this._styles[t] = true);
	}

	public get element(): HTMLElement {
		return this.row && this.row.element;
	}

	public insertInDOM(container: HTMLElement, afterElement: HTMLElement): void {
		if (!this.row) {
			this.row = this.context.cache.alloc(this.templateId);

			// used in reverse lookup from HTMLElement to Item
			(<any>this.element)[TableView.BINDING] = this;
		}

		if (this.element.parentElement) {
			return;
		}

		if (afterElement === null) {
			container.appendChild(this.element);
		} else {
			try {
				container.insertBefore(this.element, afterElement);
			} catch (e) {
				console.warn('Failed to locate previous tree element');
				container.appendChild(this.element);
			}
		}

		this.render();
	}

	public removeFromDOM(): void {
		if (!this.row) {
			return;
		}

		(<any>this.element)[TableView.BINDING] = null;
		this.context.cache.release(this.templateId, this.row);
		this.row = null;
	}

	public dispose(): void {
		this.row = null;
		this.model = null;
	}
}

export class ViewCell implements IViewCell {
	public model: Model.Cell;
	public top: number;
	public height: number;
}

interface IThrottledGestureEvent {
	translationX: number;
	translationY: number;
}

export class TableView extends HeightMap {

	static BINDING = 'monaco-table-row';

	private static counter: number = 0;
	private instance: number;

	private context: IViewContext;
	private model: Model.TableModel;

	private viewListeners: Lifecycle.IDisposable[];
	private domNode: HTMLElement;
	private wrapper: HTMLElement;
	private styleElement: HTMLStyleElement;
	private scrollableElement: ScrollableElement;
	private rowsContainer: HTMLElement;
	private msGesture: MSGesture;
	private lastPointerType: string;
	private lastClickTimeStamp: number = 0;

	private lastRenderTop: number;
	private lastRenderHeight: number;

	private isRefreshing = false;

	private didJustPressContextMenuKey: boolean;

	private onHiddenScrollTop: number;

	private _onDOMFocus: Emitter<void> = new Emitter<void>();
	get onDOMFocus(): Event<void> { return this._onDOMFocus.event; }

	private _onDOMBlur: Emitter<void> = new Emitter<void>();
	get onDOMBlur(): Event<void> { return this._onDOMBlur.event; }

	constructor(context: _.ITableContext, container: HTMLElement) {
		super();

		TableView.counter++;
		this.instance = TableView.counter;

		this.context = {
			dataSource: context.dataSource,
			renderer: context.renderer,
			controller: context.controller,
			// filter: context.filter,
			// sorter: context.sorter,
			table: context.table,
			// accessibilityProvider: context.accessibilityProvider,
			options: context.options,
			cache: new CellCache(context)
		};

		this.viewListeners = [];

		this.domNode = document.createElement('table');
		this.domNode.className = `monaco-table no-focused-item monaco-table-instance-${this.instance}`;

		this.styleElement = DOM.createStyleSheet(this.domNode);

		if (this.context.options.ariaLabel) {
			this.domNode.setAttribute('aria-label', this.context.options.ariaLabel);
		}

		this.wrapper = document.createElement('div');
		this.wrapper.className = 'monaco-table-wrapper';
		this.scrollableElement = new ScrollableElement(this.wrapper, {
			alwaysConsumeMouseWheel: true,
			horizontal: ScrollbarVisibility.Hidden,
			vertical: /* (typeof context.options.verticalScrollMode !== 'undefined' ? context.options.verticalScrollMode : */ ScrollbarVisibility.Auto,
			useShadows: context.options.useShadows
		});
		this.scrollableElement.onScroll((e) => {
			this.render(e.scrollTop, e.height);
		});

		if (Browser.isIE) {
			this.wrapper.style.msTouchAction = 'none';
			this.wrapper.style.msContentZooming = 'none';
		} else {
			Touch.Gesture.addTarget(this.wrapper);
		}

		this.rowsContainer = document.createElement('tbody');
		this.rowsContainer.className = 'monaco-table-rows';

		let focusTracker = DOM.trackFocus(this.domNode);
		this.viewListeners.push(focusTracker.onDidFocus(() => this.onFocus()));
		this.viewListeners.push(focusTracker.onDidBlur(() => this.onBlur()));
		this.viewListeners.push(focusTracker);

		this.viewListeners.push(DOM.addDisposableListener(this.domNode, 'keydown', (e) => this.onKeyDown(e)));
		this.viewListeners.push(DOM.addDisposableListener(this.domNode, 'keyup', (e) => this.onKeyUp(e)));
		this.viewListeners.push(DOM.addDisposableListener(this.domNode, 'mousedown', (e) => this.onMouseDown(e)));
		this.viewListeners.push(DOM.addDisposableListener(this.domNode, 'mouseup', (e) => this.onMouseUp(e)));
		this.viewListeners.push(DOM.addDisposableListener(this.wrapper, 'click', (e) => this.onClick(e)));
		this.viewListeners.push(DOM.addDisposableListener(this.wrapper, 'auxclick', (e) => this.onClick(e))); // >= Chrome 56
		this.viewListeners.push(DOM.addDisposableListener(this.domNode, 'contextmenu', (e) => this.onContextMenu(e)));
		this.viewListeners.push(DOM.addDisposableListener(this.wrapper, Touch.EventType.Tap, (e) => this.onTap(e)));
		this.viewListeners.push(DOM.addDisposableListener(this.wrapper, Touch.EventType.Change, (e) => this.onTouchChange(e)));

		if (Browser.isIE) {
			this.viewListeners.push(DOM.addDisposableListener(this.wrapper, 'MSPointerDown', (e) => this.onMsPointerDown(e)));
			this.viewListeners.push(DOM.addDisposableListener(this.wrapper, 'MSGestureTap', (e) => this.onMsGestureTap(e)));

			// these events come too fast, we throttle them
			this.viewListeners.push(DOM.addDisposableThrottledListener<IThrottledGestureEvent>(this.wrapper, 'MSGestureChange', (e) => this.onThrottledMsGestureChange(e), (lastEvent: IThrottledGestureEvent, event: MSGestureEvent): IThrottledGestureEvent => {
				event.stopPropagation();
				event.preventDefault();

				var result = { translationY: event.translationY, translationX: event.translationX };

				if (lastEvent) {
					result.translationY += lastEvent.translationY;
					result.translationX += lastEvent.translationX;
				}

				return result;
			}));
		}

		this.wrapper.appendChild(this.rowsContainer);
		this.domNode.appendChild(this.scrollableElement.getDomNode());
		container.appendChild(this.domNode);

		this.lastRenderTop = 0;
		this.lastRenderHeight = 0;

		this.didJustPressContextMenuKey = false;


		this.onHiddenScrollTop = null;

		this.onRowsChanged();
		this.layout();

		this.setupMSGesture();

		this.applyStyles(context.options);

	}

	public applyStyles(styles: _.ITableStyles): void {
		const content: string[] = [];

		if (styles.listFocusBackground) {
			content.push(`.monaco-tree.monaco-tree-instance-${this.instance}.focused .monaco-tree-rows > .monaco-tree-row.focused:not(.highlighted) { background-color: ${styles.listFocusBackground}; }`);
		}

		if (styles.listFocusForeground) {
			content.push(`.monaco-tree.monaco-tree-instance-${this.instance}.focused .monaco-tree-rows > .monaco-tree-row.focused:not(.highlighted) { color: ${styles.listFocusForeground}; }`);
		}

		if (styles.listActiveSelectionBackground) {
			content.push(`.monaco-tree.monaco-tree-instance-${this.instance}.focused .monaco-tree-rows > .monaco-tree-row.selected:not(.highlighted) { background-color: ${styles.listActiveSelectionBackground}; }`);
		}

		if (styles.listActiveSelectionForeground) {
			content.push(`.monaco-tree.monaco-tree-instance-${this.instance}.focused .monaco-tree-rows > .monaco-tree-row.selected:not(.highlighted) { color: ${styles.listActiveSelectionForeground}; }`);
		}

		if (styles.listFocusAndSelectionBackground) {
			content.push(`
				.monaco-tree-drag-image,
				.monaco-tree.monaco-tree-instance-${this.instance}.focused .monaco-tree-rows > .monaco-tree-row.focused.selected:not(.highlighted) { background-color: ${styles.listFocusAndSelectionBackground}; }
			`);
		}

		if (styles.listFocusAndSelectionForeground) {
			content.push(`
				.monaco-tree-drag-image,
				.monaco-tree.monaco-tree-instance-${this.instance}.focused .monaco-tree-rows > .monaco-tree-row.focused.selected:not(.highlighted) { color: ${styles.listFocusAndSelectionForeground}; }
			`);
		}

		if (styles.listInactiveSelectionBackground) {
			content.push(`.monaco-tree.monaco-tree-instance-${this.instance} .monaco-tree-rows > .monaco-tree-row.selected:not(.highlighted) { background-color: ${styles.listInactiveSelectionBackground}; }`);
		}

		if (styles.listInactiveSelectionForeground) {
			content.push(`.monaco-tree.monaco-tree-instance-${this.instance} .monaco-tree-rows > .monaco-tree-row.selected:not(.highlighted) { color: ${styles.listInactiveSelectionForeground}; }`);
		}

		if (styles.listHoverBackground) {
			content.push(`.monaco-tree.monaco-tree-instance-${this.instance} .monaco-tree-rows > .monaco-tree-row:hover:not(.highlighted):not(.selected):not(.focused) { background-color: ${styles.listHoverBackground}; }`);
		}

		if (styles.listHoverForeground) {
			content.push(`.monaco-tree.monaco-tree-instance-${this.instance} .monaco-tree-rows > .monaco-tree-row:hover:not(.highlighted):not(.selected):not(.focused) { color: ${styles.listHoverForeground}; }`);
		}

		if (styles.listDropBackground) {
			content.push(`
				.monaco-tree.monaco-tree-instance-${this.instance} .monaco-tree-wrapper.drop-target,
				.monaco-tree.monaco-tree-instance-${this.instance} .monaco-tree-rows > .monaco-tree-row.drop-target { background-color: ${styles.listDropBackground} !important; color: inherit !important; }
			`);
		}

		if (styles.listFocusOutline) {
			content.push(`
				.monaco-tree-drag-image																															{ border: 1px solid ${styles.listFocusOutline}; background: #000; }
				.monaco-tree.monaco-tree-instance-${this.instance} .monaco-tree-rows > .monaco-tree-row 														{ border: 1px solid transparent; }
				.monaco-tree.monaco-tree-instance-${this.instance}.focused .monaco-tree-rows > .monaco-tree-row.focused:not(.highlighted) 						{ border: 1px dotted ${styles.listFocusOutline}; }
				.monaco-tree.monaco-tree-instance-${this.instance}.focused .monaco-tree-rows > .monaco-tree-row.selected:not(.highlighted) 						{ border: 1px solid ${styles.listFocusOutline}; }
				.monaco-tree.monaco-tree-instance-${this.instance} .monaco-tree-rows > .monaco-tree-row.selected:not(.highlighted)  							{ border: 1px solid ${styles.listFocusOutline}; }
				.monaco-tree.monaco-tree-instance-${this.instance} .monaco-tree-rows > .monaco-tree-row:hover:not(.highlighted):not(.selected):not(.focused)  	{ border: 1px dashed ${styles.listFocusOutline}; }
				.monaco-tree.monaco-tree-instance-${this.instance} .monaco-tree-wrapper.drop-target,
				.monaco-tree.monaco-tree-instance-${this.instance} .monaco-tree-rows > .monaco-tree-row.drop-target												{ border: 1px dashed ${styles.listFocusOutline}; }
			`);
		}

		this.styleElement.innerHTML = content.join('\n');
	}

	private render(scrollTop: number, viewHeight: number): void {
		var i: number;
		var stop: number;

		var renderTop = scrollTop;
		var renderBottom = scrollTop + viewHeight;
		var thisRenderBottom = this.lastRenderTop + this.lastRenderHeight;

		// when view scrolls down, start rendering from the renderBottom
		for (i = this.indexAfter(renderBottom) - 1, stop = this.indexAt(Math.max(thisRenderBottom, renderTop)); i >= stop; i--) {
			this.insertItemInDOM(<ViewRow>this.itemAtIndex(i));
		}

		// when view scrolls up, start rendering from either this.renderTop or renderBottom
		for (i = Math.min(this.indexAt(this.lastRenderTop), this.indexAfter(renderBottom)) - 1, stop = this.indexAt(renderTop); i >= stop; i--) {
			this.insertItemInDOM(<ViewRow>this.itemAtIndex(i));
		}

		// when view scrolls down, start unrendering from renderTop
		for (i = this.indexAt(this.lastRenderTop), stop = Math.min(this.indexAt(renderTop), this.indexAfter(thisRenderBottom)); i < stop; i++) {
			this.removeItemFromDOM(<ViewRow>this.itemAtIndex(i));
		}

		// when view scrolls up, start unrendering from either renderBottom this.renderTop
		for (i = Math.max(this.indexAfter(renderBottom), this.indexAt(this.lastRenderTop)), stop = this.indexAfter(thisRenderBottom); i < stop; i++) {
			this.removeItemFromDOM(<ViewRow>this.itemAtIndex(i));
		}

		var topItem = this.itemAtIndex(this.indexAt(renderTop));

		if (topItem) {
			this.rowsContainer.style.top = (topItem.top - renderTop) + 'px';
		}

		this.lastRenderTop = renderTop;
		this.lastRenderHeight = renderBottom - renderTop;
	}

	private onRowsChanged(scrollTop: number = this.scrollTop): void {
		if (this.isRefreshing) {
			return;
		}

		this.scrollTop = scrollTop;
	}


	private getCellAround(element: HTMLElement): ViewCell {
		return undefined;
	}

	public get scrollTop(): number {
		const scrollPosition = this.scrollableElement.getScrollPosition();
		return scrollPosition.scrollTop;
	}

	public set scrollTop(scrollTop: number) {
		this.scrollableElement.setScrollDimensions({
			scrollHeight: this.getTotalHeight()
		});
		this.scrollableElement.setScrollPosition({
			scrollTop: scrollTop
		});
	}

	public getScrollPosition(): number {
		const height = this.getTotalHeight() - this.viewHeight;
		return height <= 0 ? 1 : this.scrollTop / height;
	}

	public setScrollPosition(pos: number): void {
		const height = this.getTotalHeight() - this.viewHeight;
		this.scrollTop = height * pos;
	}

	public get viewHeight() {
		const scrollDimensions = this.scrollableElement.getScrollDimensions();
		return scrollDimensions.height;
	}

	public set viewHeight(viewHeight: number) {
		this.scrollableElement.setScrollDimensions({
			height: viewHeight,
			scrollHeight: this.getTotalHeight()
		});
	}

	private setupMSGesture(): void {
		if ((<any>window).MSGesture) {
			this.msGesture = new MSGesture();
			setTimeout(() => this.msGesture.target = this.wrapper, 100); // TODO@joh, TODO@IETeam
		}
	}

	// DOM changes

	private insertItemInDOM(item: ViewRow): void {
		var elementAfter: HTMLElement = null;
		var itemAfter = <ViewRow>this.itemAfter(item);

		if (itemAfter && itemAfter.element) {
			elementAfter = itemAfter.element;
		}

		item.insertInDOM(this.rowsContainer, elementAfter);
	}

	private removeItemFromDOM(item: ViewRow): void {
		if (!item) {
			return;
		}

		item.removeFromDOM();
	}



	public onHidden(): void {
		this.onHiddenScrollTop = this.scrollTop;
	}

	private isTreeVisible(): boolean {
		return this.onHiddenScrollTop === null;
	}

	public layout(height?: number): void {
		if (!this.isTreeVisible()) {
			return;
		}

		this.viewHeight = height || DOM.getContentHeight(this.wrapper); // render
	}


	private onFocus(): void {
		// if (!this.context.options.alwaysFocused) {
		DOM.addClass(this.domNode, 'focused');
		// }

		this._onDOMFocus.fire();
	}

	private onBlur(): void {
		// if (!this.context.options.alwaysFocused) {
		DOM.removeClass(this.domNode, 'focused');
		// }

		// this.domNode.removeAttribute('aria-activedescendant'); // ARIA

		this._onDOMBlur.fire();
	}

	private onKeyDown(e: KeyboardEvent): void {
		var event = new Keyboard.StandardKeyboardEvent(e);

		this.didJustPressContextMenuKey = event.keyCode === KeyCode.ContextMenu || (event.shiftKey && event.keyCode === KeyCode.F10);

		if (this.didJustPressContextMenuKey) {
			event.preventDefault();
			event.stopPropagation();
		}

		if (event.target && event.target.tagName && event.target.tagName.toLowerCase() === 'input') {
			return; // Ignore event if target is a form input field (avoids browser specific issues)
		}

		this.context.controller.onKeyDown(this.context.table, event);
	}

	private onKeyUp(e: KeyboardEvent): void {
		if (this.didJustPressContextMenuKey) {
			this.onContextMenu(e);
		}

		this.didJustPressContextMenuKey = false;
		this.context.controller.onKeyUp(this.context.table, new Keyboard.StandardKeyboardEvent(e));
	}

	private onMouseDown(e: MouseEvent): void {
		this.didJustPressContextMenuKey = false;

		if (!this.context.controller.onMouseDown) {
			return;
		}

		if (this.lastPointerType && this.lastPointerType !== 'mouse') {
			return;
		}

		var event = new Mouse.StandardMouseEvent(e);

		if (event.ctrlKey && Platform.isNative && Platform.isMacintosh) {
			return;
		}

		var item = this.getCellAround(event.target);

		if (!item) {
			return;
		}

		this.context.controller.onMouseDown(this.context.table, item.model.getElement(), event);
	}

	private onMouseUp(e: MouseEvent): void {
		if (!this.context.controller.onMouseUp) {
			return;
		}

		if (this.lastPointerType && this.lastPointerType !== 'mouse') {
			return;
		}

		var event = new Mouse.StandardMouseEvent(e);

		if (event.ctrlKey && Platform.isNative && Platform.isMacintosh) {
			return;
		}

		var item = this.getCellAround(event.target);

		if (!item) {
			return;
		}

		this.context.controller.onMouseUp(this.context.table, item.model.getElement(), event);
	}

	private onClick(e: MouseEvent): void {
		if (this.lastPointerType && this.lastPointerType !== 'mouse') {
			return;
		}

		var event = new Mouse.StandardMouseEvent(e);
		var item = this.getCellAround(event.target);

		if (!item) {
			return;
		}

		if (Browser.isIE && Date.now() - this.lastClickTimeStamp < 300) {
			// IE10+ doesn't set the detail property correctly. While IE10 simply
			// counts the number of clicks, IE11 reports always 1. To align with
			// other browser, we set the value to 2 if clicks events come in a 300ms
			// sequence.
			event.detail = 2;
		}
		this.lastClickTimeStamp = Date.now();

		this.context.controller.onClick(this.context.table, item.model.getElement(), event);
	}

	private onContextMenu(keyboardEvent: KeyboardEvent): void;
	private onContextMenu(mouseEvent: MouseEvent): void;
	private onContextMenu(event: KeyboardEvent | MouseEvent): void {
		var resultEvent: _.ContextMenuEvent;
		var element: any;

		if (event instanceof KeyboardEvent || this.didJustPressContextMenuKey) {
			this.didJustPressContextMenuKey = false;

			var keyboardEvent = new Keyboard.StandardKeyboardEvent(<KeyboardEvent>event);
			element = this.model.getFocus();

			var position: DOM.IDomNodePagePosition;

			// if (!element) {
			// 	element = this.model.getInput();
			// 	position = DOM.getDomNodePagePosition(this.inputItem.element);
			// } else {
			// 	var id = this.context.dataSource.getId(this.context.table, element);
			// 	var viewItem = this.items[id];
			// 	position = DOM.getDomNodePagePosition(viewItem.element);
			// }

			resultEvent = new _.KeyboardContextMenuEvent(position.left + position.width, position.top, keyboardEvent);

		} else {
			var mouseEvent = new Mouse.StandardMouseEvent(<MouseEvent>event);
			var item = this.getCellAround(mouseEvent.target);

			if (!item) {
				return;
			}

			element = item.model.getElement();
			resultEvent = new _.MouseContextMenuEvent(mouseEvent);
		}

		this.context.controller.onContextMenu(this.context.table, element, resultEvent);
	}

	private onTap(e: Touch.GestureEvent): void {
		var item = this.getCellAround(<HTMLElement>e.initialTarget);

		if (!item) {
			return;
		}

		this.context.controller.onTap(this.context.table, item.model.getElement(), e);
	}

	private onTouchChange(event: Touch.GestureEvent): void {
		event.preventDefault();
		event.stopPropagation();

		this.scrollTop -= event.translationY;
	}

	private onMsPointerDown(event: MSPointerEvent): void {
		if (!this.msGesture) {
			return;
		}

		// Circumvent IE11 breaking change in e.pointerType & TypeScript's stale definitions
		var pointerType = event.pointerType;
		if (pointerType === ((<any>event).MSPOINTER_TYPE_MOUSE || 'mouse')) {
			this.lastPointerType = 'mouse';
			return;
		} else if (pointerType === ((<any>event).MSPOINTER_TYPE_TOUCH || 'touch')) {
			this.lastPointerType = 'touch';
		} else {
			return;
		}

		event.stopPropagation();
		event.preventDefault();

		this.msGesture.addPointer(event.pointerId);
	}

	private onMsGestureTap(event: MSGestureEvent): void {
		(<any>event).initialTarget = document.elementFromPoint(event.clientX, event.clientY);
		this.onTap(<any>event);
	}

	private onThrottledMsGestureChange(event: IThrottledGestureEvent): void {
		this.scrollTop -= event.translationY;
	}
}
