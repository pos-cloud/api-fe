import { Controller, Post, Body } from '@nestjs/common';
import { WsaaService } from './afip/wsaa/wsaa.service';
import { Wsfev1Service } from './afip/wsfev1/wsfev1.service';
import { Transaction, TransactionConfig, CanceledTransaction } from './models';
@Controller()
export class AppController {
  constructor(
    private readonly wsaaService: WsaaService,
    private readonly wsfev1Service: Wsfev1Service,
  ) {}

  @Post('validate-transaction')
  async validateTransaction(
    @Body('config') config: TransactionConfig,
    @Body('transaction') transaction: Transaction,
    @Body('canceledTransactions') canceledTransactions: CanceledTransaction,
  ): Promise<any> {
    try {
      const cuit = `${config.companyIdentificationValue}`;
      const vatCondition = config.vatCondition;
      if (!transaction.type.codes.length) {
        throw new Error('Códigos AFIP no definidos');
      }
      const expirationTime = await this.wsaaService.getIfNotExpired(cuit);
      if (!expirationTime) {
        const response = await this.wsaaService.generarTA(cuit);
      }
      const TA = await this.wsaaService.getTA(cuit);

      const doctipo = transaction.company.identificationType.code;
      const docnumber = transaction.company.identificationValue;

      const tipcomp = transaction.type.codes.find(
        (item) => item.letter == transaction.letter,
      ).code;

      const ptovta = transaction.origin;
      const tipocbte = tipcomp;
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const cbteFecha = `${year}${month}${day}`;
      let baseimp = 0;
      let impIVA = 0;
      let impneto = 0;
      let exempt = 0;
      if (transaction.letter !== 'C') {
        exempt = transaction.exempt;
        if (transaction.taxes.length > 0) {
          for (let i = 0; i < transaction.taxes.length; i++) {
            baseimp = transaction.taxes[i].percentage;
            impneto = impneto + transaction.taxes[i].taxBase;
            impIVA = impIVA + transaction.taxes[i].taxAmount;
          }
        }
      } else {
        impneto = impneto + transaction.totalPrice;
      }
      const datosDeUltimoComprobanteAutorizado =
        await this.wsfev1Service.buscarUltimoComprobanteAutorizado(
          TA.credentials[0].token[0],
          TA.credentials[0].sign[0],
          cuit,
          ptovta,
          tipocbte,
        );
      const nro = datosDeUltimoComprobanteAutorizado.CbteNro;
      if (typeof nro !== 'number') {
        throw new Error('Último comprobante autorizado no es numérico');
      }
      const nro1 = nro + 1;
      const regfe = {};
      regfe['CbteTipo'] = tipocbte;
      regfe['Concepto'] = 1; //Productos: 1 ---- Servicios: 2 ---- Prod y Serv: 3
      regfe['DocTipo'] = doctipo; //80=CUIT -- 96 DNI --- 99 general cons final
      regfe['DocNro'] = docnumber; //0 para consumidor final / importe menor a 1000
      regfe['CbteFch'] = cbteFecha; // fecha emision de factura
      regfe['ImpNeto'] = impneto; // Imp Neto
      regfe['ImpTotConc'] = exempt; // no gravado
      regfe['ImpIVA'] = impIVA; // IVA liquidado
      regfe['ImpTrib'] = 0; // otros tributos
      regfe['ImpOpEx'] = 0; // operacion exentas
      regfe['ImpTotal'] = transaction['totalPrice']; // total de la factura. ImpNeto + ImpTotConc + ImpIVA + ImpTrib + ImpOpEx
      regfe['FchServDesde'] = null; // solo concepto 2 o 3
      regfe['FchServHasta'] = null; // solo concepto 2 o 3
      regfe['FchVtoPago'] = null; // solo concepto 2 o 3
      regfe['MonId'] = 'PES'; // Id de moneda 'PES'
      regfe['MonCotiz'] = 1; // Cotizacion moneda. Solo exportacion

      // Detalle de otros tributos
      const regfetrib = {};
      regfetrib['Id'] = 1;
      regfetrib['Desc'] = '';
      regfetrib['BaseImp'] = 0;
      regfetrib['Alic'] = 0;
      regfetrib['Importe'] = 0;

      const regfeiva = {};

      if (baseimp !== 0) {
        regfeiva['Id'] = 5;
        regfeiva['BaseImp'] = impneto;
        regfeiva['Importe'] = impIVA;
      } else {
        regfeiva['Id'] = 0;
        regfeiva['BaseImp'] = 0;
        regfeiva['Importe'] = 0;
      }

      const Opcional = transaction?.optionalAFIP?.value
        ? {
            Id: transaction.optionalAFIP.id,
            Valor: transaction.optionalAFIP.value,
          }
        : null;

      const CbteAsoc = canceledTransactions
        ? {
            Tipo: canceledTransactions.code,
            PtoVta: canceledTransactions.origin,
            Nro: canceledTransactions.number,
          }
        : null;

      const FeCabReq = {
        CantReg: 1,
        PtoVta: ptovta,
        CbteTipo: regfe['CbteTipo'],
      };
      const FECAEDetRequest = {
        Concepto: regfe['Concepto'],
        DocTipo: regfe['DocTipo'],
        DocNro: regfe['DocNro'],
        CbteDesde: nro1,
        CbteHasta: nro1,
        CbteFch: regfe['CbteFch'],
        ImpNeto: regfe['ImpNeto'],
        ImpTotConc: regfe['ImpTotConc'],
        ImpIVA: regfe['ImpIVA'],
        ImpTrib: regfe['ImpTrib'],
        ImpOpEx: regfe['ImpOpEx'],
        ImpTotal: regfe['ImpTotal'],
        FchServDesde: regfe['FchServDesde'],
        FchServHasta: regfe['FchServHasta'],
        FchVtoPago: regfe['FchVtoPago'],
        MonId: regfe['MonId'],
        MonCotiz: regfe['MonCotiz'],
        Tributos: {
          Tributo: {
            Id: regfetrib['Id'],
            Desc: regfetrib['Desc'],
            BaseImp: regfetrib['BaseImp'],
            Alic: regfetrib['Alic'],
            Importe: regfetrib['Importe'],
          },
        },
        Iva: {
          AlicIva: {
            Id: regfeiva['Id'],
            BaseIm: regfeiva['BaseImp'],
            Importe: regfeiva['Importe'],
          },
        },
      };
      if (CbteAsoc) {
        FECAEDetRequest['CbtesAsoc'] = {
          CbteAsoc,
        };
      }
      if (Opcional) {
        FECAEDetRequest['Opcionales'] = {
          Opcional,
        };
      }

      if (vatCondition == 6 || regfeiva['Id'] === 0) {
        FECAEDetRequest['Iva'] = null;
      }
      const caeData = await this.wsfev1Service.solicitarCAE(
        TA.credentials[0].token,
        TA.credentials[0].sign,
        cuit,
        FeCabReq,
        FECAEDetRequest,
      );

      const message =
        caeData.FeDetResp.FECAEDetResponse[0].CAE == ''
          ? caeData.FeDetResp.FECAEDetResponse[0].Observaciones.Obs.map(
              (observacion) => `${observacion.Code} - ${observacion.Msg}`,
            ).join(', ')
          : 'Successful';

      return {
        data: {
          caeData,
          number: nro1,
          CAE: caeData.FeDetResp.FECAEDetResponse[0].CAE,
          CAEExpirationDate: caeData.FeDetResp.FECAEDetResponse[0].CAEFchVto,
        },

        message,
      };
    } catch (error) {
      console.log(error);
      return {
        status: 'Error',
        message: error.message,
      };
    }
  }
}
