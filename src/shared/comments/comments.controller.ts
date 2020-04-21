import Comment, { CommentRefTypes } from '@libs/db/models/comment.model'
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger'
import { DocumentType } from '@typegoose/typegoose'
import { RolesGuard } from 'src/auth/roles.guard'
import { Master } from 'src/core/decorators/guest.decorator'
import { IpLocation, IpRecord } from 'src/core/decorators/ip.decorator'
import { CannotFindException } from 'src/core/exceptions/cant-find.exception'
import { PagerDto } from 'src/shared/base/dto/pager.dto'
import {
  CommentDto,
  CommentRefTypesDto,
  TextOnlyDto,
} from 'src/shared/comments/dto/comment.dto'
import { Pager } from 'src/shared/comments/dto/pager.dto'
import { StateQueryDto } from 'src/shared/comments/dto/state.dto'
import { IdDto } from '../base/dto/id.dto'
import { CommentsService } from './comments.service'
import { Auth } from 'src/core/decorators/auth.decorator'

@Controller('comments')
@ApiTags('Comment Routes')
@UseGuards(RolesGuard)
export class CommentsController {
  constructor(private readonly commentService: CommentsService) {}

  @Get()
  // @Auth()
  async getRecentlyComments(@Query() query: Pager) {
    const { size = 10, page = 1, state = 0 } = query
    return await this.commentService.getRecently({ size, page, state })
  }

  @Get(':id')
  @ApiOperation({ summary: '根据 comment id 获取评论, 包括子评论' })
  async getComments(@Param() params: IdDto) {
    const { id } = params
    const data = await this.commentService
      .findOne({
        _id: id,
      })
      .populate('parent')
    if (!data) {
      throw new CannotFindException()
    }
    return data
  }

  @Get('/ref/:id')
  @ApiParam({
    name: 'id',
    description: 'refId',
    example: '5e6f67e85b303781d28072a3',
  })
  @ApiOperation({ summary: '根据评论的 refId 获取评论, 如 Post Id' })
  async getCommentsByRefId(@Param() params: IdDto, @Query() query: PagerDto) {
    const { id } = params
    const { page = 1, size = 10, select } = query
    const comments = await this.commentService.findWithPaginator(
      {
        parent: undefined,
        ref: id,
      },
      {
        limit: size,
        skip: (page - 1) * size,
        select,
        sort: { created: -1 },
      },
    )
    return comments
  }

  @Get('info')
  @UseGuards(AuthGuard('jwt'))
  @ApiSecurity('bearer')
  @ApiOperation({ summary: '获取评论各类型的数量的接口' })
  async getCommentsInfo() {
    const passed = await this.commentService.countDocument({
      state: 1,
    })
    const gomi = await this.commentService.countDocument({ state: 2 })
    const needChecked = await this.commentService.countDocument({
      state: 0,
    })

    return {
      passed,
      gomi,
      needChecked,
    }
  }

  @Post(':id')
  @ApiOperation({ summary: '根据文章的 _id 评论' })
  async comment(
    @Param() params: IdDto,
    @Body() body: CommentDto,
    @Body('author') author: string,
    @Master() isMaster: boolean,
    @IpLocation() ipLocation: IpRecord,
    @Query() query: CommentRefTypesDto,
  ) {
    if (!isMaster) {
      await this.commentService.ValidAuthorName(author)
    }
    const { ref } = query

    const id = params.id
    const model = { ...body, ...ipLocation }
    try {
      const comment = await this.commentService.createComment(
        id,
        ref || CommentRefTypes.Post,
        model,
      )
      return comment
    } catch {
      throw new CannotFindException()
    }
  }

  @Post('/reply/:id')
  @ApiParam({
    name: 'id',
    description: 'cid',
    example: '5e7370bec56432cbac578e2d',
  })
  async replyByCid(
    @Param() params: IdDto,
    @Body() body: CommentDto,
    @Body('author') author: string,
    @Master() isMaster: boolean,
    @IpLocation() ipLocation: IpRecord,
  ) {
    if (!isMaster) {
      await this.commentService.ValidAuthorName(author)
    }

    const { id } = params
    const parent = await this.commentService.findById(id).populate('ref')
    if (!parent) {
      throw new CannotFindException()
    }
    const commentIndex = parent.commentsIndex
    const key = `${parent.key}#${commentIndex + 1}`

    const model: Partial<Comment> = {
      parent,
      ref: (parent.ref as DocumentType<any>)._id,
      refType: parent.refType,
      ...body,
      ...ipLocation,
      key,
    }

    const res = await this.commentService.createNew(model)

    await parent.updateOne({
      $push: {
        children: res._id,
      },
      $inc: {
        commentsIndex: 1,
      },
    })

    return { msg: '回复成功!' }
  }

  @Post('/master/comment/:id')
  @ApiOperation({ summary: '主人专用评论接口 需要登录' })
  @UseGuards(AuthGuard('jwt'))
  @ApiSecurity('bearer')
  async commentByMaster(
    @Req() req: any,
    @Param() params: IdDto,
    @Body() body: TextOnlyDto,
    @IpLocation() ipLocation: IpRecord,
    @Query() query: CommentRefTypesDto,
  ) {
    // console.log(req.user)
    const { name, mail, url } = req.user
    const model: CommentDto = {
      author: name,
      ...body,
      mail,
      url,
    }
    return await this.comment(
      params,
      model as any,
      undefined,
      true,
      ipLocation,
      query,
    )
  }

  @Post('/master/reply/:id')
  @ApiOperation({ summary: '主人专用评论回复 需要登录' })
  @ApiParam({ name: 'id', description: 'cid' })
  @UseGuards(AuthGuard('jwt'))
  @ApiSecurity('bearer')
  async replyByMaster(
    @Req() req: any,
    @Param() params: IdDto,
    @Body() body: TextOnlyDto,
    @IpLocation() ipLocation: IpRecord,
  ) {
    const { name, mail, url } = req.user
    const model: CommentDto = {
      author: name,
      ...body,
      mail,
      url,
    }
    return await this.replyByCid(params, model, undefined, true, ipLocation)
  }
  @Put(':id')
  @ApiOperation({ summary: '修改评论的状态' })
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  async modifyCommentState(
    @Param() params: IdDto,
    @Query() query: StateQueryDto,
  ) {
    const { id } = params
    const { state } = query

    try {
      const query = await this.commentService.updateAsync(
        {
          _id: id,
        },
        { state },
      )

      return query
    } catch {
      throw new CannotFindException()
    }
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiSecurity('bearer')
  async deleteComment(@Param() params: IdDto) {
    const { id } = params
    return await this.commentService.deleteComments(id)
  }
}
