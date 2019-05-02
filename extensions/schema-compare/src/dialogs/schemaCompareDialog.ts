/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vscode-nls';
import * as azdata from 'azdata';
import * as vscode from 'vscode';
import * as os from 'os';
import { SchemaCompareResult } from '../schemaCompareResult';

const localize = nls.loadMessageBundle();
const CompareButtonText: string = localize('schemaCompareDialog.Compare', 'Compare');
const CancelButtonText: string = localize('schemaCompareDialog.Cancel', 'Cancel');
const SourceTextBoxLabel: string = localize('schemaCompareDialog.SourceLabel', 'Source File');
const TargetTextBoxLabel: string = localize('schemaCompareDialog.TargetLabel', 'Target File');
const DacpacRadioButtonLabel: string = localize('schemaCompare.dacpacRadioButtonLabel', 'Data-tier Application File (.dacpac)');
const DatabaseRadioButtonLabel: string = localize('schemaCompare.databaseButtonLabel', 'Database');
const SourceRadioButtonsLabel: string = localize('schemaCompare.sourceButtonsLabel', 'Source Type');
const TargetRadioButtonsLabel: string = localize('schemaCompare.targetButtonsLabel', 'Target Type');
const NoActiveConnectionsLabel: string = localize('schemaCompare.NoActiveConnectionsText', 'No active connections');
const SchemaCompareLabel: string = localize('schemaCompare.dialogTitle', 'Schema Compare');

export class SchemaCompareDialog {
	public dialog: azdata.window.Dialog;
	public dialogName: string;
	private schemaCompareTab: azdata.window.DialogTab;
	private sourceDacpacComponent: azdata.FormComponent;
	private sourceTextBox: azdata.InputBoxComponent;
	private sourceFileButton: azdata.ButtonComponent;
	private sourceServerComponent: azdata.FormComponent;
	private sourceServerDropdown: azdata.DropDownComponent;
	private sourceDatabaseComponent: azdata.FormComponent;
	private sourceDatabaseDropdown: azdata.DropDownComponent;
	private sourceNoActiveConnectionsText: azdata.FormComponent;
	private targetDacpacComponent: azdata.FormComponent;
	private targetTextBox: azdata.InputBoxComponent;
	private targetFileButton: azdata.ButtonComponent;
	private targetServerComponent: azdata.FormComponent;
	private targetServerDropdown: azdata.DropDownComponent;
	private targetDatabaseComponent: azdata.FormComponent;
	private targetDatabaseDropdown: azdata.DropDownComponent;
	private targetNoActiveConnectionsText: azdata.FormComponent;
	private formBuilder: azdata.FormBuilder;
	private sourceIsDacpac: boolean;
	private targetIsDacpac: boolean;
	private database: string;
	private connectionId: string;

	protected initializeDialog(): void {
		this.schemaCompareTab = azdata.window.createTab(SchemaCompareLabel);
		this.initializeSchemaCompareTab();
		this.dialog.content = [this.schemaCompareTab];
	}

	public async openDialog(context: azdata.ObjectExplorerContext, dialogName?: string): Promise<void> {
		let profile = context ? context.connectionProfile : undefined;
		if (profile) {
			this.database = profile.databaseName;
			this.connectionId = profile.id;
		} else {
			let connection = await azdata.connection.getCurrentConnection();
			if (connection) {
				this.connectionId = connection.connectionId;
			}
		}

		let event = dialogName ? dialogName : null;
		this.dialog = azdata.window.createModelViewDialog(SchemaCompareLabel, event);

		this.initializeDialog();

		this.dialog.okButton.label = CompareButtonText;
		this.dialog.okButton.onClick(async () => await this.execute());

		this.dialog.cancelButton.label = CancelButtonText;
		this.dialog.cancelButton.onClick(async () => await this.cancel());

		azdata.window.openDialog(this.dialog);
	}

	protected async execute(): Promise<void> {
		let sourceName: string;
		let targetName: string;

		let sourceEndpointInfo: azdata.SchemaCompareEndpointInfo;
		if (this.sourceIsDacpac) {
			sourceName = this.sourceTextBox.value;
			sourceEndpointInfo = {
				endpointType: azdata.SchemaCompareEndpointType.Dacpac,
				serverName: '',
				databaseName: '',
				ownerUri: '',
				packageFilePath: this.sourceTextBox.value
			};
		} else {
			sourceName = (this.sourceServerDropdown.value as ConnectionDropdownValue).name + '.' + (<azdata.CategoryValue>this.sourceDatabaseDropdown.value).name;
			let ownerUri = await azdata.connection.getUriForConnection((this.sourceServerDropdown.value as ConnectionDropdownValue).connection.connectionId);

			sourceEndpointInfo = {
				endpointType: azdata.SchemaCompareEndpointType.Database,
				serverName: (this.sourceServerDropdown.value as ConnectionDropdownValue).name,
				databaseName: (<azdata.CategoryValue>this.sourceDatabaseDropdown.value).name,
				ownerUri: ownerUri,
				packageFilePath: ''
			};
		}

		let targetEndpointInfo: azdata.SchemaCompareEndpointInfo;
		if (this.targetIsDacpac) {
			targetName = this.targetTextBox.value;
			targetEndpointInfo = {
				endpointType: azdata.SchemaCompareEndpointType.Dacpac,
				serverName: '',
				databaseName: '',
				ownerUri: '',
				packageFilePath: this.targetTextBox.value
			};
		} else {
			targetName = (this.targetServerDropdown.value as ConnectionDropdownValue).name + '.' + (<azdata.CategoryValue>this.targetDatabaseDropdown.value).name;
			let ownerUri = await azdata.connection.getUriForConnection((this.targetServerDropdown.value as ConnectionDropdownValue).connection.connectionId);

			targetEndpointInfo = {
				endpointType: azdata.SchemaCompareEndpointType.Database,
				serverName: (this.targetServerDropdown.value as ConnectionDropdownValue).name,
				databaseName: (<azdata.CategoryValue>this.targetDatabaseDropdown.value).name,
				ownerUri: ownerUri,
				packageFilePath: ''
			};
		}

		let schemaCompareResult = new SchemaCompareResult(sourceName, targetName, sourceEndpointInfo, targetEndpointInfo);
		schemaCompareResult.start();
	}

	protected async cancel(): Promise<void> {
	}

	private initializeSchemaCompareTab(): void {
		this.schemaCompareTab.registerContent(async view => {
			this.sourceTextBox = view.modelBuilder.inputBox().withProperties({
				width: 275
			}).component();

			this.targetTextBox = view.modelBuilder.inputBox().withProperties({
				width: 275
			}).component();

			this.sourceServerComponent = await this.createSourceServerDropdown(view);
			await this.populateServerDropdown(false);

			this.sourceDatabaseComponent = await this.createSourceDatabaseDropdown(view);
			if ((this.sourceServerDropdown.value as ConnectionDropdownValue)) {
				await this.populateDatabaseDropdown((this.sourceServerDropdown.value as ConnectionDropdownValue).connection.connectionId, false);
			}

			this.targetServerComponent = await this.createTargetServerDropdown(view);
			await this.populateServerDropdown(true);

			this.targetDatabaseComponent = await this.createTargetDatabaseDropdown(view);
			if ((this.targetServerDropdown.value as ConnectionDropdownValue)) {
				await this.populateDatabaseDropdown((this.targetServerDropdown.value as ConnectionDropdownValue).connection.connectionId, true);
			}

			this.sourceDacpacComponent = await this.createFileBrowser(view, false);
			this.targetDacpacComponent = await this.createFileBrowser(view, true);

			let sourceRadioButtons = await this.createSourceRadiobuttons(view);
			let targetRadioButtons = await this.createTargetRadiobuttons(view);

			this.sourceNoActiveConnectionsText = await this.createNoActiveConnectionsText(view);
			this.targetNoActiveConnectionsText = await this.createNoActiveConnectionsText(view);

			// if schema compare was launched from a db context menu, set that db as the source
			if (this.database) {
				this.formBuilder = view.modelBuilder.formContainer()
					.withFormItems([
						sourceRadioButtons,
						this.sourceServerComponent,
						this.sourceDatabaseComponent,
						targetRadioButtons,
						this.targetDacpacComponent
					], {
							horizontal: true
						});
			} else {
				this.formBuilder = view.modelBuilder.formContainer()
					.withFormItems([
						sourceRadioButtons,
						this.sourceDacpacComponent,
						targetRadioButtons,
						this.targetDacpacComponent
					], {
							horizontal: true
						});
			}
			let formModel = this.formBuilder.component();
			await view.initializeModel(formModel);
		});
	}

	private async createFileBrowser(view: azdata.ModelView, isTarget: boolean): Promise<azdata.FormComponent> {
		let currentTextbox = isTarget ? this.targetTextBox : this.sourceTextBox;
		if (isTarget) {
			this.targetFileButton = view.modelBuilder.button().withProperties({
				label: '•••',
			}).component();
		} else {
			this.sourceFileButton = view.modelBuilder.button().withProperties({
				label: '•••',
			}).component();
		}

		let currentButton = isTarget ? this.targetFileButton : this.sourceFileButton;

		currentButton.onDidClick(async (click) => {
			let rootPath = vscode.workspace.rootPath ? vscode.workspace.rootPath : os.homedir();
			let fileUris = await vscode.window.showOpenDialog(
				{
					canSelectFiles: true,
					canSelectFolders: false,
					canSelectMany: false,
					defaultUri: vscode.Uri.file(rootPath),
					openLabel: localize('schemaCompare.openFile', 'Open'),
					filters: {
						'dacpac Files': ['dacpac'],
					}
				}
			);

			if (!fileUris || fileUris.length === 0) {
				return;
			}

			let fileUri = fileUris[0];
			currentTextbox.value = fileUri.fsPath;
		});

		return {
			component: currentTextbox,
			title: isTarget ? TargetTextBoxLabel : SourceTextBoxLabel,
			actions: [currentButton]
		};
	}

	private async createSourceRadiobuttons(view: azdata.ModelView): Promise<azdata.FormComponent> {
		let dacpacRadioButton = view.modelBuilder.radioButton()
			.withProperties({
				name: 'source',
				label: DacpacRadioButtonLabel
			}).component();

		let databaseRadioButton = view.modelBuilder.radioButton()
			.withProperties({
				name: 'source',
				label: DatabaseRadioButtonLabel
			}).component();

		// show dacpac file browser
		dacpacRadioButton.onDidClick(() => {
			this.sourceIsDacpac = true;
			this.formBuilder.removeFormItem(this.sourceNoActiveConnectionsText);
			this.formBuilder.removeFormItem(this.sourceServerComponent);
			this.formBuilder.removeFormItem(this.sourceDatabaseComponent);
			this.formBuilder.insertFormItem(this.sourceDacpacComponent, 1, { horizontal: true });
		});

		// show server and db dropdowns or 'No active connections' text
		databaseRadioButton.onDidClick(() => {
			this.sourceIsDacpac = false;
			if ((this.sourceServerDropdown.value as ConnectionDropdownValue)) {
				this.formBuilder.insertFormItem(this.sourceServerComponent, 1, { horizontal: true, componentWidth: 300 });
				this.formBuilder.insertFormItem(this.sourceDatabaseComponent, 2, { horizontal: true, componentWidth: 300 });
			} else {
				this.formBuilder.insertFormItem(this.sourceNoActiveConnectionsText, 1, { horizontal: true });
			}
			this.formBuilder.removeFormItem(this.sourceDacpacComponent);
		});

		if (this.database) {
			databaseRadioButton.checked = true;
			this.sourceIsDacpac = false;
		} else {
			dacpacRadioButton.checked = true;
			this.sourceIsDacpac = true;
		}
		let flexRadioButtonsModel = view.modelBuilder.flexContainer()
			.withLayout({ flexFlow: 'column' })
			.withItems([dacpacRadioButton, databaseRadioButton]
			).component();

		return {
			component: flexRadioButtonsModel,
			title: SourceRadioButtonsLabel
		};
	}

	private async createTargetRadiobuttons(view: azdata.ModelView): Promise<azdata.FormComponent> {
		let dacpacRadioButton = view.modelBuilder.radioButton()
			.withProperties({
				name: 'target',
				label: DacpacRadioButtonLabel
			}).component();

		let databaseRadioButton = view.modelBuilder.radioButton()
			.withProperties({
				name: 'target',
				label: DatabaseRadioButtonLabel
			}).component();

		// show dacpac file browser
		dacpacRadioButton.onDidClick(() => {
			this.targetIsDacpac = true;
			this.formBuilder.removeFormItem(this.targetNoActiveConnectionsText);
			this.formBuilder.removeFormItem(this.targetServerComponent);
			this.formBuilder.removeFormItem(this.targetDatabaseComponent);
			this.formBuilder.addFormItem(this.targetDacpacComponent, { horizontal: true });
		});

		// show server and db dropdowns or 'No active connections' text
		databaseRadioButton.onDidClick(() => {
			this.targetIsDacpac = false;
			this.formBuilder.removeFormItem(this.targetDacpacComponent);
			if ((this.targetServerDropdown.value as ConnectionDropdownValue)) {
				this.formBuilder.addFormItem(this.targetServerComponent, { horizontal: true, componentWidth: 300 });
				this.formBuilder.addFormItem(this.targetDatabaseComponent, { horizontal: true, componentWidth: 300 });
			} else {
				this.formBuilder.addFormItem(this.targetNoActiveConnectionsText, { horizontal: true });
			}
		});

		dacpacRadioButton.checked = true;
		this.targetIsDacpac = true;
		let flexRadioButtonsModel = view.modelBuilder.flexContainer()
			.withLayout({ flexFlow: 'column' })
			.withItems([dacpacRadioButton, databaseRadioButton]
			).component();

		return {
			component: flexRadioButtonsModel,
			title: TargetRadioButtonsLabel
		};
	}

	protected async createSourceServerDropdown(view: azdata.ModelView): Promise<azdata.FormComponent> {
		this.sourceServerDropdown = view.modelBuilder.dropDown().component();
		this.sourceServerDropdown.onValueChanged(async () => {
			await this.populateDatabaseDropdown((this.sourceServerDropdown.value as ConnectionDropdownValue).connection.connectionId, false);
		});

		return {
			component: this.sourceServerDropdown,
			title: localize('schemaCompare.sourceServerDropdownTitle', 'Source Server')
		};
	}

	protected async createTargetServerDropdown(view: azdata.ModelView): Promise<azdata.FormComponent> {
		this.targetServerDropdown = view.modelBuilder.dropDown().component();
		this.targetServerDropdown.onValueChanged(async () => {
			await this.populateDatabaseDropdown((this.targetServerDropdown.value as ConnectionDropdownValue).connection.connectionId, true);
		});

		return {
			component: this.targetServerDropdown,
			title: localize('schemaCompare.targetServerDropdownTitle', 'Target Server')
		};
	}

	protected async populateServerDropdown(isTarget: boolean): Promise<void> {
		let currentDropdown = isTarget ? this.targetServerDropdown : this.sourceServerDropdown;
		let values = await this.getServerValues();

		currentDropdown.updateProperties({
			values: values
		});
	}

	protected async getServerValues(): Promise<{ connection: azdata.connection.Connection, displayName: string, name: string }[]> {
		let cons = await azdata.connection.getActiveConnections();
		// This user has no active connections
		if (!cons || cons.length === 0) {
			return undefined;
		}

		let count = -1;
		let idx = -1;
		let values = cons.map(c => {
			count++;

			if (c.connectionId === this.connectionId) {
				idx = count;
			}

			let db = c.options.databaseDisplayName;
			let usr = c.options.user;
			let srv = c.options.server;

			if (!db) {
				db = '<default>';
			}

			if (!usr) {
				usr = 'default';
			}

			let finalName = `${srv}, ${db} (${usr})`;
			return {
				connection: c,
				displayName: finalName,
				name: srv
			};
		});

		if (idx >= 0) {
			let tmp = values[0];
			values[0] = values[idx];
			values[idx] = tmp;
		}

		return values;
	}

	protected async createSourceDatabaseDropdown(view: azdata.ModelView): Promise<azdata.FormComponent> {
		this.sourceDatabaseDropdown = view.modelBuilder.dropDown().component();

		return {
			component: this.sourceDatabaseDropdown,
			title: localize('schemaCompare.sourceDatabaseDropdownTitle', 'Source Database')
		};
	}

	protected async createTargetDatabaseDropdown(view: azdata.ModelView): Promise<azdata.FormComponent> {
		this.targetDatabaseDropdown = view.modelBuilder.dropDown().component();

		return {
			component: this.targetDatabaseDropdown,
			title: localize('schemaCompare.targetDatabaseDropdownTitle', 'Target Database')
		};
	}

	protected async populateDatabaseDropdown(connectionId: string, isTarget: boolean): Promise<void> {
		let currentDropdown = isTarget ? this.targetDatabaseDropdown : this.sourceDatabaseDropdown;
		currentDropdown.updateProperties({ values: [] });

		let values = await this.getDatabaseValues(connectionId);
		currentDropdown.updateProperties({
			values: values
		});
	}

	protected async getDatabaseValues(connectionId: string): Promise<{ displayName, name }[]> {
		let idx = -1;
		let count = -1;
		let values = (await azdata.connection.listDatabases(connectionId)).map(db => {
			count++;
			// if schema compare was launched from a db context menu, set that db at the top of the dropdown
			if (this.database && db === this.database) {
				idx = count;
			}

			return {
				displayName: db,
				name: db
			};
		});

		if (idx >= 0) {
			let tmp = values[0];
			values[0] = values[idx];
			values[idx] = tmp;
		}
		return values;
	}

	protected async createNoActiveConnectionsText(view: azdata.ModelView): Promise<azdata.FormComponent> {
		let noActiveConnectionsText = view.modelBuilder.text().withProperties({ value: NoActiveConnectionsLabel }).component();

		return {
			component: noActiveConnectionsText,
			title: ''
		};
	}
}

interface ConnectionDropdownValue extends azdata.CategoryValue {
	connection: azdata.connection.Connection;
}