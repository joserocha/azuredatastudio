/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
import { INewConnectionParams, IConnectionResult, IConnectionManagementService } from 'sql/platform/connection/common/connectionManagement';
import { IConnectionProfile } from 'sql/platform/connection/common/interfaces';
import { IConnectionDialogService } from 'sql/workbench/services/connection/common/connectionDialogService';

export class ConnectionDialogTestService implements IConnectionDialogService {
	_serviceBrand: any;

	public showDialog(connectionManagementService: IConnectionManagementService,
		params: INewConnectionParams, model: IConnectionProfile, connectionResult?: IConnectionResult): Promise<void> {
		let none: void;
		return Promise.resolve(none);
	}

	public openDialogAndWait(connectionManagementService: IConnectionManagementService,
		params?: INewConnectionParams, model?: IConnectionProfile, connectionResult?: IConnectionResult): Promise<IConnectionProfile> {
		return Promise.resolve(undefined);
	}

	public openDialogAndWaitButDontConnect(connectionManagementService: IConnectionManagementService,
		params?: INewConnectionParams, model?: IConnectionProfile, connectionResult?: IConnectionResult): Promise<IConnectionProfile> {
		return Promise.resolve(undefined);
	}
}
