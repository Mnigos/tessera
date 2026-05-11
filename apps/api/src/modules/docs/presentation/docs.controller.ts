import {
	Controller,
	Get,
	Header,
	Logger,
	type OnModuleInit,
} from '@nestjs/common'
import { getHtmlDocument } from '@scalar/core/libs/html-rendering'
import { DocsService } from '../application/docs.service'

const OPENAPI_PATH = '/openapi.json'

@Controller()
export class DocsController implements OnModuleInit {
	private readonly logger = new Logger(DocsController.name)

	constructor(private readonly docsService: DocsService) {}

	onModuleInit() {
		this.logger.log('Docs available at /docs')
	}

	@Get(OPENAPI_PATH)
	generateOpenAPIDocument() {
		return this.docsService.generateOpenAPIDocument()
	}

	@Get('/docs')
	@Header('Content-Type', 'text/html')
	getScalarDocs() {
		return getHtmlDocument({ url: OPENAPI_PATH })
	}
}
